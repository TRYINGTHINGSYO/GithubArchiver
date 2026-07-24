import { describe, expect, it } from 'vitest';
import { classifyRepo, normalizeCategory, REPO_CATEGORIES } from '$lib/server/classify-repo';
import {
	detectSignalTier,
	isGenericRepoName,
	isStrongGarbageName,
	scoreRepoInteresting
} from '$lib/server/score-repo';
import { summarizeRepo } from '$lib/server/summarize-repo';

describe('summarize-repo', () => {
	it('prefers description with language hint', () => {
		const summary = summarizeRepo({
			description: 'A fast CLI for managing widgets.',
			language: 'Rust',
			topics: ['cli']
		});
		expect(summary).toContain('CLI');
		expect(summary).toContain('Rust');
	});

	it('truncates long summaries', () => {
		const summary = summarizeRepo({
			description: 'x'.repeat(400),
			language: null,
			topics: []
		});
		expect(summary.length).toBeLessThanOrEqual(280);
	});
});

describe('classify-repo', () => {
	it('detects AI projects from MCP topics', () => {
		const result = classifyRepo({
			owner: 'acme',
			name: 'my-mcp-server',
			full_name: 'acme/my-mcp-server',
			description: 'An MCP server for tools',
			language: 'TypeScript',
			topics: ['mcp', 'ai'],
			stars: 12,
			forks: 2
		});
		expect(result.category).toBe('ai-project');
		expect(result.confidence).toBeGreaterThan(0.7);
	});

	it('detects school assignments from classroom topics', () => {
		const result = classifyRepo({
			owner: 'student',
			name: 'lab-3',
			full_name: 'student/lab-3',
			description: null,
			language: 'Python',
			topics: ['github-classroom'],
			stars: 0,
			forks: 0
		});
		expect(result.category).toBe('school-assignment');
	});

	it('detects games from godot topics', () => {
		const result = classifyRepo({
			owner: 'dev',
			name: 'platformer',
			full_name: 'dev/platformer',
			description: 'A 2D platformer',
			language: 'GDScript',
			topics: ['godot', 'game'],
			stars: 5,
			forks: 1
		});
		expect(result.category).toBe('game');
	});

	it('detects libraries from package topics', () => {
		const result = classifyRepo({
			owner: 'acme',
			name: 'widget',
			full_name: 'acme/widget',
			description: 'A small utility library',
			language: 'Go',
			topics: ['library', 'cli'],
			stars: 20,
			forks: 2,
			filePaths: ['cmd/widget/main.go', 'pkg/widget/widget.go']
		});
		expect(result.category).toBe('library');
	});

	it('maps legacy categories', () => {
		expect(normalizeCategory('web-app')).toBe('product');
		expect(normalizeCategory('data-ml')).toBe('data-science');
		expect(normalizeCategory('product')).toBe('product');
	});

	it('exports the full taxonomy', () => {
		expect(REPO_CATEGORIES).toContain('ai-project');
		expect(REPO_CATEGORIES).toContain('spam-template');
		expect(REPO_CATEGORIES).toContain('awesome-list');
		expect(REPO_CATEGORIES).toHaveLength(16);
	});
});

describe('score-repo', () => {
	it('flags generic names', () => {
		expect(isGenericRepoName('test')).toBe(true);
		expect(isGenericRepoName('hello-world')).toBe(true);
		expect(isGenericRepoName('123')).toBe(true);
		expect(isStrongGarbageName('abcd')).toBe(true);
		expect(isGenericRepoName('cursor-agent-runtime')).toBe(false);
	});

	it('scores popular repos higher than empty shells', () => {
		const popular = scoreRepoInteresting({
			owner: 'acme',
			name: 'useful-toolkit',
			full_name: 'acme/useful-toolkit',
			description: 'A well-documented toolkit for building developer tools with clear examples.',
			language: 'Rust',
			topics: ['library', 'cli'],
			stars: 250,
			forks: 40,
			owner_type: 'Organization',
			pushed_at: new Date().toISOString(),
			readmeExcerpt: '# Useful Toolkit\n\n'.repeat(50)
		});

		const shell = scoreRepoInteresting({
			owner: 'user',
			name: 'test',
			full_name: 'user/test',
			description: null,
			language: null,
			topics: [],
			stars: 0,
			forks: 0,
			pushed_at: null
		});

		expect(popular.score).toBeGreaterThan(shell.score);
		expect(popular.score).toBeGreaterThan(50);
	});

	it('marks garbage repos as low signal', () => {
		const score = scoreRepoInteresting({
			owner: 'user',
			name: '123',
			full_name: 'user/123',
			description: null,
			language: null,
			topics: [],
			stars: 0,
			forks: 0
		});
		const tier = detectSignalTier(
			{
				owner: 'user',
				name: '123',
				full_name: 'user/123',
				description: null,
				language: null,
				topics: [],
				stars: 0,
				forks: 0
			},
			score.score
		);
		expect(tier).toBe('low');
	});

	it('marks strong repos as high signal', () => {
		const input = {
			owner: 'org',
			name: 'promising-saas',
			full_name: 'org/promising-saas',
			description: 'A production SaaS platform with paying customers and a public roadmap.',
			language: 'TypeScript',
			topics: ['saas', 'startup'],
			stars: 120,
			forks: 18,
			owner_type: 'Organization',
			pushed_at: new Date().toISOString(),
			readmeExcerpt: '# Promising SaaS\n\n'.repeat(80)
		};
		const { score } = scoreRepoInteresting(input);
		const tier = detectSignalTier(input, score);
		expect(tier).toBe('high');
		expect(score).toBeGreaterThan(65);
	});
});
