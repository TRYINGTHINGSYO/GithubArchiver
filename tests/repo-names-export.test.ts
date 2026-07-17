import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import {
	REPO_NAMES_AI_PROMPT,
	buildRepoNamesJsonExport,
	buildRepoNamesTextExport,
	listRepoNamesForExport
} from '../src/lib/server/repo-names-export';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('repo names export', () => {
	beforeEach(() => {
		setupTestDb();
		const db = getDb();
		const now = '2026-07-01T12:00:00.000Z';
		db.prepare(
			`INSERT INTO repos (owner, name, full_name, github_url, event_id, created_at, first_seen_at, discovery_source, description, language, stars)
			 VALUES ('acme', 'widgets', 'acme/widgets', 'https://github.com/acme/widgets', 'e1', ?, ?, 'github_search', 'Widget toolkit', 'TypeScript', 12)`
		).run(now, now);
		db.prepare(
			`INSERT INTO repos (owner, name, full_name, github_url, event_id, created_at, first_seen_at, discovery_source, deleted_at)
			 VALUES ('beta', 'gone', 'beta/gone', 'https://github.com/beta/gone', 'e2', ?, ?, 'github_search', ?)`
		).run(now, now, '2026-01-01T00:00:00Z');
	});

	afterEach(() => {
		teardownTestDb();
	});

	it('lists repo names and includes the AI prompt in text/json exports', () => {
		const all = listRepoNamesForExport('all');
		expect(all.map((r) => r.full_name)).toEqual(['acme/widgets', 'beta/gone']);
		expect(listRepoNamesForExport('active').map((r) => r.full_name)).toEqual(['acme/widgets']);
		expect(listRepoNamesForExport('deleted').map((r) => r.full_name)).toEqual(['beta/gone']);

		const text = buildRepoNamesTextExport('all');
		expect(text.count).toBe(2);
		expect(text.body).toContain(REPO_NAMES_AI_PROMPT.split('\n')[0]!);
		expect(text.body).toContain('acme/widgets');
		expect(text.body).toContain('description: Widget toolkit');
		expect(text.filename).toBe('githubarchive-repo-names-all.txt');

		const json = buildRepoNamesJsonExport('all');
		const parsed = JSON.parse(json.body) as {
			prompt: string;
			count: number;
			repositories: Array<{ full_name: string }>;
		};
		expect(parsed.prompt).toBe(REPO_NAMES_AI_PROMPT);
		expect(parsed.count).toBe(2);
		expect(parsed.repositories.map((r) => r.full_name)).toEqual(['acme/widgets', 'beta/gone']);
	});
});
