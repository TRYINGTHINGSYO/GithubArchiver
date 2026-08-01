import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyRepo } from '$lib/server/classify-repo';
import { filterConflictingClusterSets } from '$lib/server/cluster-compatibility';
import { clusterRepo } from '$lib/server/cluster-repo';
import {
	applyOwnerPatternReclassify,
	detectOwnerPatterns,
	getHumanOverride,
	normalizeDescriptionTemplate,
	previewOwnerPatternReclassify,
	saveIntelligenceReview
} from '$lib/server/intelligence-audit';
import { applyRepoIntelligence, reapplyRepoIntelligence } from '$lib/server/apply-repo-intelligence';
import { getDb } from '$lib/server/db/connection';
import { getRepoById } from '$lib/server/db/repos';
import { CURRENT_SCORING_VERSION } from '$lib/server/scoring-version';
import { createTestRepo, setupTestDb, teardownTestDb, testEnrichment } from './helpers/db';

describe('classification quality regressions', () => {
	it('classifies telegram/discord/trading bots as bot, not library', () => {
		const telegram = classifyRepo({
			owner: 'dev',
			name: 'telegram-ai-terminal',
			full_name: 'dev/telegram-ai-terminal',
			description: 'Telegram bot with AI terminal access and command handlers',
			language: 'TypeScript',
			topics: ['telegram', 'telegram-bot', 'ai'],
			stars: 12,
			forks: 1,
			readmeExcerpt: 'Set BOT_TOKEN and use telegraf webhook polling.'
		});
		expect(telegram.category).toBe('bot');
		expect(telegram.scoringVersion).toBe(CURRENT_SCORING_VERSION);

		const discord = classifyRepo({
			owner: 'dev',
			name: 'moderation-bot',
			full_name: 'dev/moderation-bot',
			description: 'Discord bot for server moderation',
			language: 'JavaScript',
			topics: ['discord-bot'],
			stars: 8,
			forks: 0,
			readmeExcerpt: 'Uses discord.js command handlers.'
		});
		expect(discord.category).toBe('bot');

		const trading = classifyRepo({
			owner: 'dev',
			name: 'crypto-trading-bot',
			full_name: 'dev/crypto-trading-bot',
			description: 'Automated trading bot for crypto markets',
			language: 'Python',
			topics: ['trading-bot'],
			stars: 30,
			forks: 4,
			readmeExcerpt: 'Configure exchange API keys for the trading bot.'
		});
		expect(trading.category).toBe('bot');
	});

	it('keeps personal portfolio websites as personal-website without contradiction cues', () => {
		const result = classifyRepo({
			owner: 'jane',
			name: 'jane.github.io',
			full_name: 'jane/jane.github.io',
			description: 'My Professional Portfolio Website',
			language: 'HTML',
			topics: ['portfolio'],
			stars: 2,
			forks: 0,
			homepage: 'https://jane.github.io',
			filePaths: ['index.html', '_config.yml'],
			readmeExcerpt: 'Personal portfolio site with resume pages.'
		});
		expect(result.category).toBe('personal-website');
	});

	it('does not classify portfolio-data-mining as a portfolio website from the name token', () => {
		const result = classifyRepo({
			owner: 'research',
			name: 'portfolio-data-mining',
			full_name: 'research/portfolio-data-mining',
			description: 'Data mining toolkit for financial portfolio analytics',
			language: 'Python',
			topics: ['data-mining', 'machine-learning'],
			stars: 15,
			forks: 2,
			readmeExcerpt: 'Notebooks and pipelines for portfolio analytics research.'
		});
		expect(result.category).not.toBe('portfolio');
		expect(result.category).not.toBe('personal-website');
		expect(['data-science', 'dataset', 'research-project', 'ai-project', 'library']).toContain(
			result.category
		);
	});

	it('does not classify AI interview simulator as portfolio', () => {
		const result = classifyRepo({
			owner: 'acme',
			name: 'ai-interview-simulator',
			full_name: 'acme/ai-interview-simulator',
			description: 'AI interview simulator for practicing coding interviews',
			language: 'TypeScript',
			topics: ['ai', 'interview'],
			stars: 40,
			forks: 5,
			readmeExcerpt: 'LLM-powered interview practice application with chat UI.'
		});
		expect(result.category).not.toBe('portfolio');
		expect(result.category).not.toBe('personal-website');
	});

	it('detects api-evangelist style company profile templates', () => {
		const result = classifyRepo({
			owner: 'api-evangelist',
			name: 'acme-corp-profile',
			full_name: 'api-evangelist/acme-corp-profile',
			description: 'Company profile (portfolio lead) — Acme Corp',
			language: 'HTML',
			topics: [],
			stars: 0,
			forks: 0
		});
		expect(result.category).toBe('company-profile');
	});

	it('requires positive package evidence for library', () => {
		const lib = classifyRepo({
			owner: 'acme',
			name: 'widgets',
			full_name: 'acme/widgets',
			description: 'A reusable SDK published to npm',
			language: 'TypeScript',
			topics: ['library', 'sdk'],
			stars: 20,
			forks: 2,
			readmeExcerpt: 'npm install @acme/widgets — exported public API.',
			filePaths: ['package.json', 'src/index.ts']
		});
		expect(lib.category).toBe('library');
	});
});

describe('cluster compatibility and generic weighting', () => {
	it('treats telegram-bots + ai-agents as compatible secondaries', () => {
		const { conflicting } = filterConflictingClusterSets(['telegram-bots', 'ai-agents', 'llm-wrappers']);
		expect(conflicting).toBe(false);
	});

	it('flags portfolio-websites vs trading-bots as incompatible', () => {
		const { conflicting, incompatiblePairs } = filterConflictingClusterSets([
			'portfolio-websites',
			'trading-bots'
		]);
		expect(conflicting).toBe(true);
		expect(incompatiblePairs.length).toBeGreaterThan(0);
	});

	it('does not cluster portfolio-data-mining into portfolio-websites', () => {
		const matches = clusterRepo({
			owner: 'research',
			name: 'portfolio-data-mining',
			full_name: 'research/portfolio-data-mining',
			description: 'Data mining toolkit for financial portfolio analytics',
			language: 'Python',
			topics: ['data-mining', 'machine-learning'],
			category: 'data-science',
			readmeExcerpt: 'Machine learning pipelines for portfolio analytics research.'
		});
		expect(matches.some((m) => m.slug === 'portfolio-websites')).toBe(false);
	});
});

describe('owner patterns, overrides, and bulk review', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('detects repeated owner description templates', () => {
		for (let i = 0; i < 4; i++) {
			const repo = createTestRepo();
			getDb()
				.prepare(`UPDATE repos SET owner = ?, description = ?, category = ? WHERE id = ?`)
				.run(
					'api-evangelist',
					`Company profile (portfolio lead) — Company ${i}`,
					'portfolio',
					repo.id
				);
		}
		const patterns = detectOwnerPatterns(10);
		expect(patterns.some((p) => p.owner === 'api-evangelist' && p.matching_repos >= 3)).toBe(true);
		expect(normalizeDescriptionTemplate('Company profile (portfolio lead) — Acme')).toContain(
			'company profile'
		);
	});

	it('preserves human overrides during reclassification', () => {
		const repo = createTestRepo();
		applyRepoIntelligence(repo, testEnrichment({ description: 'A small utility library', topics: ['library'] }));
		saveIntelligenceReview({
			repositoryId: repo.id,
			outcome: 'incorrect-category',
			reviewedCategory: 'bot',
			notes: 'manual correction'
		});
		expect(getHumanOverride(repo.id)?.category).toBe('bot');
		const refreshed = getRepoById(repo.id);
		expect(refreshed).toBeTruthy();
		reapplyRepoIntelligence(refreshed!);
		expect(getRepoById(repo.id)?.category).toBe('bot');
	});

	it('previews and applies bulk owner-pattern reclassify with audit log', () => {
		const template = normalizeDescriptionTemplate(
			'Company profile (portfolio lead) — Example Co'
		);
		for (let i = 0; i < 3; i++) {
			const repo = createTestRepo();
			getDb()
				.prepare(`UPDATE repos SET owner = ?, description = ?, category = ? WHERE id = ?`)
				.run('api-evangelist', `Company profile (portfolio lead) — Example Co`, 'portfolio', repo.id);
		}
		const preview = previewOwnerPatternReclassify({
			owner: 'api-evangelist',
			descriptionTemplate: template,
			toCategory: 'company-profile'
		});
		expect(preview.affectedCount).toBe(3);
		const applied = applyOwnerPatternReclassify({
			owner: 'api-evangelist',
			descriptionTemplate: template,
			toCategory: 'company-profile'
		});
		expect(applied.affected).toBe(3);
		const categories = getDb()
			.prepare(`SELECT DISTINCT category FROM repos WHERE owner = 'api-evangelist'`)
			.all() as Array<{ category: string }>;
		expect(categories).toEqual([{ category: 'company-profile' }]);
		const ops = (
			getDb().prepare(`SELECT COUNT(*) AS c FROM intelligence_bulk_operations`).get() as { c: number }
		).c;
		expect(ops).toBe(1);
	});
});
