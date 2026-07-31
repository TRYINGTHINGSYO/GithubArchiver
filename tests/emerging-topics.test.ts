import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { insertRepo, saveEnrichment } from '$lib/server/db/repos';
import { CURRENT_SCHEMA_VERSION } from '$lib/server/db/schema';
import {
	CURRENT_EMERGING_DETECTION_VERSION,
	addEmergingTermAlias,
	addEmergingTermExclusion,
	detectEmergingTopics,
	excludeEmergingTopic,
	buildDuplicateEvidenceGroups,
	getEmergingTopicDetail,
	getStaleEmergingTopicSummary,
	mergeEmergingTopic,
	normalizeEvidenceDescription,
	normalizeKey,
	runEmergingTopicDetection,
	updateEmergingTopicStatus
} from '$lib/server/emerging-topics';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('emerging topic detection', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('applies schema version 18 with emerging-topic and review tables', () => {
		const db = getDb();
		const version = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;
		expect(version).toBe(CURRENT_SCHEMA_VERSION);

		const tables = (
			db
				.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?)`)
				.all(
					'emerging_topics',
					'emerging_topic_repositories',
					'emerging_term_aliases',
					'emerging_term_exclusions'
				) as { name: string }[]
		).map((row) => row.name);
		expect(tables).toContain('emerging_topics');
		expect(tables).toContain('emerging_topic_repositories');
		expect(tables).toContain('emerging_term_aliases');
		expect(tables).toContain('emerging_term_exclusions');

		const topicCols = (db.prepare('PRAGMA table_info(emerging_topics)').all() as { name: string }[]).map(
			(col) => col.name
		);
		expect(topicCols).toContain('review_reason');
		expect(topicCols).toContain('history_json');
	});

	it('normalizes equivalent MCP spellings', () => {
		expect(normalizeKey('mcp_server')).toBe('mcp-server');
		expect(normalizeKey('mcpserver')).toBe('mcp-server');
		expect(normalizeKey('model-context-protocol')).toBe('mcp');
	});

	it('detects a high-diversity current-period candidate', () => {
		seedRepos('claude-code-plugin', {
			current: 12,
			previous: 2,
			owners: 8,
			topic: 'claude-code-plugin',
			description: 'Claude Code plugin for editor automation'
		});

		const candidates = detectEmergingTopics({
			periodEnd: new Date('2026-07-15T00:00:00.000Z'),
			windowDays: 7
		});
		const candidate = candidates.find((row) => row.key === 'claude-code-plugin');
		expect(candidate).toBeDefined();
		expect(candidate?.currentCount).toBe(12);
		expect(candidate?.distinctOwnerCount).toBeGreaterThanOrEqual(5);
		expect(candidate?.emergingScore).toBeGreaterThan(35);
	});

	it('dedupes Zapret-like copied floods before scoring emerging topics', () => {
		const copiedDescription =
			'Zapret Discord Youtube Telegram VPN unblocker for Windows with identical copied setup notes';
		for (let i = 0; i < 36; i++) {
			insertSeedRepo({
				owner: `zapret-copy-owner-${i}`,
				name: `zapret-telegram-vpn-${i}`,
				topic: 'telegram-vpn',
				description: copiedDescription,
				createdAt: '2026-07-10T12:00:00.000Z',
				score: 18,
				language: 'Batchfile',
				stars: 0,
				forks: 0,
				signalTier: 'low'
			});
		}

		const candidates = detectEmergingTopics({
			periodEnd: new Date('2026-07-15T00:00:00.000Z'),
			windowDays: 7
		});
		const candidate = candidates.find((row) => row.key === 'telegram-vpn');
		expect(candidate).toBeDefined();
		expect(candidate?.currentCount).toBe(1);
		expect(candidate?.distinctOwnerCount).toBe(1);
		expect(candidate?.emergingScore).toBeLessThan(35);
		expect(candidate?.evidence.exampleRepos).toHaveLength(1);
		expect(candidate?.evidence.duplicateAnalysis?.classification).toBe(
			'duplicate-template-propagation'
		);
		expect(candidate?.evidence.duplicateAnalysis?.rawCurrentCount).toBe(36);
		expect(candidate?.evidence.duplicateAnalysis?.hiddenRelatedCopyCount).toBe(35);
		expect(candidate?.evidence.duplicateAnalysis?.groups[0]?.duplicateReason).toBe(
			'exact-description-copy'
		);
	});

	it('does not collapse independently useful repositories that share boilerplate wording', () => {
		const sharedDescription = 'Claude Code plugin for editor automation across developer tools';
		const rows = Array.from({ length: 12 }, (_, i) => {
			insertSeedRepo({
				owner: `independent-owner-${i}`,
				name: `claude-code-plugin-${i}`,
				topic: 'claude-code-plugin',
				description: sharedDescription,
				createdAt: '2026-07-10T12:00:00.000Z',
				score: 68,
				stars: 10,
				forks: 2
			});
			return getDb()
				.prepare('SELECT * FROM repos WHERE full_name = ?')
				.get(`independent-owner-${i}/claude-code-plugin-${i}`);
		});

		const groups = buildDuplicateEvidenceGroups(rows as Parameters<typeof buildDuplicateEvidenceGroups>[0]);
		expect(groups.groups).toHaveLength(12);
		expect(groups.groups.every((group) => group.duplicateReason === 'independent')).toBe(true);
		expect(normalizeEvidenceDescription(`${sharedDescription} v1.2`)).toContain('version');
	});

	it('filters single-owner floods', () => {
		seedRepos('single-owner-agent', {
			current: 15,
			previous: 0,
			owners: 1,
			topic: 'single-owner-agent',
			description: 'Single owner agent harness'
		});

		const candidates = detectEmergingTopics({
			periodEnd: new Date('2026-07-15T00:00:00.000Z'),
			windowDays: 7
		});
		expect(candidates.some((row) => row.key === 'single-owner-agent')).toBe(false);
	});

	it('persists topics, repository evidence, and review status', () => {
		seedRepos('browser-agent-harness', {
			current: 11,
			previous: 1,
			owners: 7,
			topic: 'browser-agent-harness',
			description: 'Browser agent harness for UI automation'
		});

		const result = runEmergingTopicDetection({
			periodEnd: new Date('2026-07-15T00:00:00.000Z'),
			windowDays: 7
		});
		expect(result.saved).toBeGreaterThan(0);

		const detail = getEmergingTopicDetail('browser-agent-harness');
		expect(detail?.topic.label).toBe('Browser Agent Harness');
		expect(detail?.repositories.length).toBeGreaterThan(0);

		expect(updateEmergingTopicStatus('browser-agent-harness', 'reviewing')).toBe(true);
		const updated = getEmergingTopicDetail('browser-agent-harness');
		expect(updated?.topic.status).toBe('reviewing');
	});

	it('does not serve stale v1 topic detail rows after detection version bumps', () => {
		seedRepos('versioned-topic-harness', {
			current: 11,
			previous: 1,
			owners: 7,
			topic: 'versioned-topic-harness',
			description: 'Versioned topic harness for detail routing'
		});
		runEmergingTopicDetection({ periodEnd: new Date('2026-07-15T00:00:00.000Z'), windowDays: 7 });

		getDb()
			.prepare(
				`INSERT INTO emerging_topics (
				   key, label, candidate_type, status, period_start, period_end,
				   current_count, previous_count, distinct_owner_count, average_interesting_score,
				   novelty_score, momentum_score, quality_score, emerging_score,
				   evidence_json, history_json, detection_version, generated_at
				 ) VALUES (?, ?, ?, 'detected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				'versioned-topic-harness',
				'Stale V1 Versioned Topic Harness',
				'topic',
				'2026-07-22T00:00:00.000Z',
				'2026-07-29T00:00:00.000Z',
				36,
				1,
				20,
				12,
				100,
				100,
				80,
				81,
				JSON.stringify({ currentRepoIds: [], previousRepoIds: [], exampleRepos: [] }),
				null,
				1,
				'2026-07-29T00:00:00.000Z'
			);

		const detail = getEmergingTopicDetail('versioned-topic-harness');
		expect(detail?.topic.detection_version).toBe(CURRENT_EMERGING_DETECTION_VERSION);
		expect(detail?.topic.label).toBe('Versioned Topic Harness');
		expect(detail?.topic.current_count).toBe(11);
	});

	it('returns stale topic metadata when only older detection rows exist', () => {
		getDb()
			.prepare(
				`INSERT INTO emerging_topics (
				   key, label, candidate_type, status, period_start, period_end,
				   current_count, previous_count, distinct_owner_count, average_interesting_score,
				   novelty_score, momentum_score, quality_score, emerging_score,
				   evidence_json, history_json, detection_version, generated_at
				 ) VALUES (?, ?, ?, 'detected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				'stale-only-topic',
				'Stale Only Topic',
				'topic',
				'2026-07-22T00:00:00.000Z',
				'2026-07-29T00:00:00.000Z',
				36,
				1,
				20,
				12,
				100,
				100,
				80,
				81,
				JSON.stringify({ currentRepoIds: [], previousRepoIds: [], exampleRepos: [] }),
				null,
				1,
				'2026-07-29T00:00:00.000Z'
			);

		expect(getEmergingTopicDetail('stale-only-topic')).toBeNull();
		const stale = getStaleEmergingTopicSummary('stale-only-topic');
		expect(stale).toEqual({
			key: 'stale-only-topic',
			label: 'Stale Only Topic',
			status: 'detected',
			detectionVersion: 1,
			currentVersion: CURRENT_EMERGING_DETECTION_VERSION,
			generatedAt: '2026-07-29T00:00:00.000Z',
			periodStart: '2026-07-22T00:00:00.000Z',
			periodEnd: '2026-07-29T00:00:00.000Z'
		});
	});

	it('records review reason codes alongside status changes', () => {
		seedRepos('voice-agent-router', {
			current: 11,
			previous: 1,
			owners: 7,
			topic: 'voice-agent-router',
			description: 'Voice agent router experiments'
		});
		runEmergingTopicDetection({ periodEnd: new Date('2026-07-15T00:00:00.000Z'), windowDays: 7 });

		expect(updateEmergingTopicStatus('voice-agent-router', 'promoted', 'valid-trend')).toBe(true);
		const detail = getEmergingTopicDetail('voice-agent-router');
		expect(detail?.topic.status).toBe('promoted');
		expect(detail?.topic.review_reason).toBe('valid-trend');
		expect(detail?.topic.reviewed_at).toBeTruthy();
	});

	it('persists candidate history with the topic', () => {
		seedRepos('workflow-copilot-kit', {
			current: 12,
			previous: 3,
			owners: 8,
			topic: 'workflow-copilot-kit',
			description: 'Workflow copilot kit for teams'
		});
		runEmergingTopicDetection({ periodEnd: new Date('2026-07-15T00:00:00.000Z'), windowDays: 7 });

		const detail = getEmergingTopicDetail('workflow-copilot-kit');
		expect(detail?.history).toBeTruthy();
		expect(detail?.history?.currentCount).toBe(12);
		expect(detail?.history?.previousCount).toBe(3);
		expect(detail?.history?.allTimeCount).toBe(15);
		expect(detail?.history?.consecutiveGrowthPeriods).toBeGreaterThanOrEqual(1);
		expect(detail?.history?.firstSeenAt).toBeTruthy();
	});

	it('merges aliased spellings into one canonical candidate', () => {
		addEmergingTermAlias('claudecode-plugin', 'claude-code-plugin');
		seedRepos('claude-code-plugin', {
			current: 7,
			previous: 1,
			owners: 7,
			topic: 'claude-code-plugin',
			description: 'Claude Code plugin for editor automation'
		});
		seedRepos('claudecode-plugin', {
			current: 6,
			previous: 1,
			owners: 6,
			topic: 'claudecode-plugin',
			description: 'ClaudeCode plugin variant spelling'
		});

		const candidates = detectEmergingTopics({
			periodEnd: new Date('2026-07-15T00:00:00.000Z'),
			windowDays: 7
		});
		const merged = candidates.find((row) => row.key === 'claude-code-plugin');
		expect(merged).toBeDefined();
		expect(merged?.currentCount).toBe(13);
		expect(candidates.some((row) => row.key === 'claudecode-plugin')).toBe(false);
		expect(Object.keys(merged?.evidence.aliasHits ?? {})).toContain('claudecode-plugin');
	});

	it('drops excluded terms from future detection runs', () => {
		addEmergingTermExclusion('fullstack-webapp-starter', 'generic-term');
		seedRepos('fullstack-webapp-starter', {
			current: 12,
			previous: 2,
			owners: 8,
			topic: 'fullstack-webapp-starter',
			description: 'Fullstack webapp starter boilerplate'
		});

		const candidates = detectEmergingTopics({
			periodEnd: new Date('2026-07-15T00:00:00.000Z'),
			windowDays: 7
		});
		expect(candidates.some((row) => row.key === 'fullstack-webapp-starter')).toBe(false);
	});

	it('merge and exclude review actions dismiss the topic and persist rules', () => {
		seedRepos('agent-eval-harness', {
			current: 11,
			previous: 1,
			owners: 7,
			topic: 'agent-eval-harness',
			description: 'Agent eval harness tooling'
		});
		seedRepos('nextjs-dashboard-template', {
			current: 11,
			previous: 1,
			owners: 7,
			topic: 'nextjs-dashboard-template',
			description: 'Nextjs dashboard template collection'
		});
		runEmergingTopicDetection({ periodEnd: new Date('2026-07-15T00:00:00.000Z'), windowDays: 7 });

		expect(mergeEmergingTopic('agent-eval-harness', 'agent-evals')).toBe(true);
		const mergedDetail = getEmergingTopicDetail('agent-eval-harness');
		expect(mergedDetail?.topic.status).toBe('dismissed');
		expect(mergedDetail?.topic.review_reason).toBe('alias-duplicate');
		const aliasRow = getDb()
			.prepare('SELECT canonical_key FROM emerging_term_aliases WHERE alias = ?')
			.get('agent-eval-harness') as { canonical_key: string };
		expect(aliasRow.canonical_key).toBe('agent-evals');

		expect(excludeEmergingTopic('nextjs-dashboard-template', 'template-flood')).toBe(true);
		const excludedDetail = getEmergingTopicDetail('nextjs-dashboard-template');
		expect(excludedDetail?.topic.status).toBe('dismissed');
		expect(excludedDetail?.topic.review_reason).toBe('template-flood');
		const exclusionRow = getDb()
			.prepare('SELECT reason FROM emerging_term_exclusions WHERE term = ?')
			.get('nextjs-dashboard-template') as { reason: string };
		expect(exclusionRow.reason).toBe('template-flood');
	});

	it('atomic merge writes alias and dismisses the source topic together', () => {
		seedRepos('router-kit-alpha', {
			current: 11,
			previous: 1,
			owners: 7,
			topic: 'router-kit-alpha',
			description: 'Router kit alpha experiments'
		});
		runEmergingTopicDetection({ periodEnd: new Date('2026-07-15T00:00:00.000Z'), windowDays: 7 });

		expect(mergeEmergingTopic('router-kit-alpha', 'router-kit')).toBe(true);
		const detail = getEmergingTopicDetail('router-kit-alpha');
		expect(detail?.topic.status).toBe('dismissed');
		expect(detail?.topic.review_reason).toBe('alias-duplicate');
		const alias = getDb()
			.prepare('SELECT canonical_key FROM emerging_term_aliases WHERE alias = ?')
			.get('router-kit-alpha') as { canonical_key: string };
		expect(alias.canonical_key).toBe('router-kit');
	});

	it('merge with a nonexistent source topic performs no mutations', () => {
		expect(mergeEmergingTopic('does-not-exist-topic', 'canonical-topic')).toBe(false);
		const alias = getDb()
			.prepare('SELECT alias FROM emerging_term_aliases WHERE alias = ?')
			.get('does-not-exist-topic');
		expect(alias).toBeUndefined();
	});

	it('failed merge rolls back the alias and leaves topic status unchanged', () => {
		seedRepos('rollback-merge-topic', {
			current: 11,
			previous: 1,
			owners: 7,
			topic: 'rollback-merge-topic',
			description: 'Rollback merge topic experiments'
		});
		runEmergingTopicDetection({ periodEnd: new Date('2026-07-15T00:00:00.000Z'), windowDays: 7 });

		const before = getEmergingTopicDetail('rollback-merge-topic');
		expect(before?.topic.status).toBe('detected');

		const db = getDb();
		db.exec(`
			CREATE TRIGGER emerging_merge_force_fail
			BEFORE UPDATE ON emerging_topics
			BEGIN
				SELECT RAISE(ABORT, 'forced merge failure');
			END;
		`);

		expect(() => mergeEmergingTopic('rollback-merge-topic', 'rollback-canonical')).toThrow(
			/forced merge failure/
		);

		db.exec('DROP TRIGGER emerging_merge_force_fail');

		const after = getEmergingTopicDetail('rollback-merge-topic');
		expect(after?.topic.status).toBe('detected');
		expect(after?.topic.review_reason).toBeNull();
		const alias = db
			.prepare('SELECT alias FROM emerging_term_aliases WHERE alias = ?')
			.get('rollback-merge-topic');
		expect(alias).toBeUndefined();
	});

	it('conflicting alias fails cleanly without partial merge changes', () => {
		seedRepos('conflict-merge-source', {
			current: 11,
			previous: 1,
			owners: 7,
			topic: 'conflict-merge-source',
			description: 'Conflict merge source experiments'
		});
		runEmergingTopicDetection({ periodEnd: new Date('2026-07-15T00:00:00.000Z'), windowDays: 7 });
		addEmergingTermAlias('conflict-merge-source', 'already-canonical');

		expect(() => mergeEmergingTopic('conflict-merge-source', 'other-canonical')).toThrow(
			/already maps to "already-canonical"/
		);

		const detail = getEmergingTopicDetail('conflict-merge-source');
		expect(detail?.topic.status).toBe('detected');
		const alias = getDb()
			.prepare('SELECT canonical_key FROM emerging_term_aliases WHERE alias = ?')
			.get('conflict-merge-source') as { canonical_key: string };
		expect(alias.canonical_key).toBe('already-canonical');
	});

	it('does not treat system as a name-token emerging candidate', () => {
		for (let i = 0; i < 12; i++) {
			insertSeedRepo({
				owner: `system-owner-${i}`,
				name: `cash-fund-system-${i}`,
				topic: 'unrelated-topic',
				description: 'A cash fund management app',
				createdAt: '2026-07-10T12:00:00.000Z',
				score: 55
			});
		}
		for (let i = 0; i < 4; i++) {
			insertSeedRepo({
				owner: `system-prev-${i}`,
				name: `cash-fund-system-prev-${i}`,
				topic: 'unrelated-topic',
				description: 'A cash fund management app',
				createdAt: '2026-07-03T12:00:00.000Z',
				score: 55
			});
		}

		const candidates = detectEmergingTopics({
			periodEnd: new Date('2026-07-15T00:00:00.000Z'),
			windowDays: 7
		});
		expect(candidates.some((row) => row.key === 'system')).toBe(false);
		expect(
			candidates.some((row) => row.key === 'system' && row.candidateType === 'name-token')
		).toBe(false);
	});

	it('does not treat platform or backend as name-token emerging candidates', () => {
		for (let i = 0; i < 12; i++) {
			insertSeedRepo({
				owner: `platform-owner-${i}`,
				name: `analytics-platform-${i}`,
				topic: 'unrelated-topic',
				description: 'Analytics platform experiments',
				createdAt: '2026-07-10T12:00:00.000Z',
				score: 55
			});
			insertSeedRepo({
				owner: `backend-owner-${i}`,
				name: `api-backend-${i}`,
				topic: 'unrelated-topic',
				description: 'API backend service',
				createdAt: '2026-07-10T12:00:00.000Z',
				score: 55
			});
		}

		const candidates = detectEmergingTopics({
			periodEnd: new Date('2026-07-15T00:00:00.000Z'),
			windowDays: 7
		});
		expect(candidates.some((row) => row.key === 'platform')).toBe(false);
		expect(candidates.some((row) => row.key === 'backend')).toBe(false);
	});

	it('drops excluded generic phrases from future detection runs', () => {
		addEmergingTermExclusion('with-python', 'generic-term');
		addEmergingTermExclusion('real-time', 'generic-term');
		for (let i = 0; i < 12; i++) {
			insertSeedRepo({
				owner: `phrase-owner-${i}`,
				name: `data-pipeline-${i}`,
				topic: 'unrelated-topic',
				description: 'Built with Python for real-time analytics pipelines',
				createdAt: '2026-07-10T12:00:00.000Z',
				score: 55
			});
		}

		const candidates = detectEmergingTopics({
			periodEnd: new Date('2026-07-15T00:00:00.000Z'),
			windowDays: 7
		});
		expect(candidates.some((row) => row.key === 'with-python')).toBe(false);
		expect(candidates.some((row) => row.key === 'real-time')).toBe(false);
	});
});

function seedRepos(
	nameStem: string,
	opts: {
		current: number;
		previous: number;
		owners: number;
		topic: string;
		description: string;
	}
): void {
	for (let i = 0; i < opts.previous; i++) {
		insertSeedRepo({
			owner: `prev-owner-${i % Math.max(1, opts.owners)}`,
			name: `${nameStem}-prev-${i}`,
			topic: opts.topic,
			description: opts.description,
			createdAt: '2026-07-03T12:00:00.000Z',
			score: 62
		});
	}

	for (let i = 0; i < opts.current; i++) {
		insertSeedRepo({
			owner: `owner-${i % Math.max(1, opts.owners)}`,
			name: `${nameStem}-${i}`,
			topic: opts.topic,
			description: opts.description,
			createdAt: '2026-07-10T12:00:00.000Z',
			score: 65 + (i % 10)
		});
	}
}

function insertSeedRepo(opts: {
	owner: string;
	name: string;
	topic: string;
	description: string;
	createdAt: string;
	score: number;
	language?: string;
	stars?: number;
	forks?: number;
	signalTier?: string;
	category?: string;
}): void {
	const inserted = insertRepo({
		owner: opts.owner,
		name: opts.name,
		full_name: `${opts.owner}/${opts.name}`,
		github_url: `https://github.com/${opts.owner}/${opts.name}`,
		event_id: `${opts.owner}-${opts.name}`,
		created_at: opts.createdAt,
		first_seen_at: opts.createdAt
	});
	if (!inserted.id) throw new Error('failed to insert repo');
	saveEnrichment(inserted.id, {
		default_branch: 'main',
		description: opts.description,
		language: opts.language ?? 'TypeScript',
		stars: opts.stars ?? 10,
		forks: opts.forks ?? 2,
		watchers: opts.stars ?? 10,
		license: 'MIT',
		topics: [opts.topic],
		pushed_at: opts.createdAt,
		updated_at: opts.createdAt
	});
	getDb()
		.prepare(
			`UPDATE repos SET
			   category = ?,
			   interesting_score = ?,
			   signal_tier = ?
			 WHERE id = ?`
		)
		.run(opts.category ?? 'ai-project', opts.score, opts.signalTier ?? 'normal', inserted.id);
}
