import { getDb } from '$lib/server/db/connection';

export type RepoNamesScope = 'all' | 'active' | 'deleted';

export interface RepoNameRow {
	full_name: string;
	description: string | null;
	language: string | null;
	stars: number | null;
	github_url: string;
	deleted_at: string | null;
}

export const REPO_NAMES_AI_PROMPT = `You are analyzing a catalog of GitHub repositories discovered and archived by GithubArchive+.

Each entry is a repository slug in the form owner/name. Optional fields may include a short description, primary language, star count, and whether the repo was later deleted on GitHub.

Your job:
1. Infer what each repository is likely for (product, library, experiment, schoolwork, spam/boilerplate, etc.).
2. Group related repos by theme, stack, org, or naming pattern.
3. Flag names that look auto-generated, empty templates, or low-signal.
4. Call out especially interesting, unusual, or historically useful projects.
5. When unsure, say so — prefer cautious guesses over invented facts.

Use only the names and metadata in this file. Do not assume a repo still exists on GitHub unless noted.`;

function scopeWhere(scope: RepoNamesScope): string {
	switch (scope) {
		case 'active':
			return 'deleted_at IS NULL';
		case 'deleted':
			return 'deleted_at IS NOT NULL';
		case 'all':
		default:
			return '1 = 1';
	}
}

export function listRepoNamesForExport(scope: RepoNamesScope = 'all'): RepoNameRow[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT full_name, description, language, stars, github_url, deleted_at
			 FROM repos
			 WHERE ${scopeWhere(scope)}
			 ORDER BY full_name COLLATE NOCASE`
		)
		.all() as RepoNameRow[];
}

export function buildRepoNamesTextExport(scope: RepoNamesScope = 'all'): {
	body: string;
	count: number;
	filename: string;
} {
	const repos = listRepoNamesForExport(scope);
	const generatedAt = new Date().toISOString();
	const lines: string[] = [
		'# GithubArchive+ repository name list for AI analysis',
		`# Generated: ${generatedAt}`,
		`# Scope: ${scope}`,
		`# Count: ${repos.length}`,
		'#',
		'# ----- AI PROMPT -----',
		...REPO_NAMES_AI_PROMPT.split('\n').map((line) => `# ${line}`),
		'# ----- END PROMPT -----',
		'#',
		'# Format per line:',
		'#   owner/name',
		'#   optional indented metadata follows (- description / language / stars / deleted)',
		'#',
		''
	];

	for (const repo of repos) {
		lines.push(repo.full_name);
		if (repo.description?.trim()) {
			lines.push(`  - description: ${repo.description.trim().replace(/\s+/g, ' ')}`);
		}
		if (repo.language) lines.push(`  - language: ${repo.language}`);
		if (repo.stars != null) lines.push(`  - stars: ${repo.stars}`);
		if (repo.deleted_at) lines.push(`  - deleted_on_github: ${repo.deleted_at}`);
	}

	return {
		body: `${lines.join('\n')}\n`,
		count: repos.length,
		filename: `githubarchive-repo-names-${scope}.txt`
	};
}

export function buildRepoNamesJsonExport(scope: RepoNamesScope = 'all'): {
	body: string;
	count: number;
	filename: string;
} {
	const repos = listRepoNamesForExport(scope);
	const payload = {
		generated_at: new Date().toISOString(),
		scope,
		count: repos.length,
		prompt: REPO_NAMES_AI_PROMPT,
		repositories: repos.map((repo) => ({
			full_name: repo.full_name,
			github_url: repo.github_url,
			description: repo.description,
			language: repo.language,
			stars: repo.stars,
			deleted_on_github: Boolean(repo.deleted_at)
		}))
	};

	return {
		body: `${JSON.stringify(payload, null, 2)}\n`,
		count: repos.length,
		filename: `githubarchive-repo-names-${scope}.json`
	};
}
