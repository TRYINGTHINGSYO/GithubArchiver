import { describe, expect, it } from 'vitest';
import { classifyRepo } from '$lib/server/classify-repo';
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
	it('detects bot repos by name', () => {
		const result = classifyRepo({
			owner: 'acme',
			name: 'release-bot',
			full_name: 'acme/release-bot',
			description: null,
			language: 'TypeScript',
			topics: [],
			stars: 5,
			forks: 1
		});
		expect(result.category).toBe('bot');
	});

	it('detects cli-tool from topics', () => {
		const result = classifyRepo({
			owner: 'acme',
			name: 'widget',
			full_name: 'acme/widget',
			description: 'command-line tool',
			language: 'Go',
			topics: ['cli'],
			stars: 20,
			forks: 2
		});
		expect(result.category).toBe('cli-tool');
	});
});
