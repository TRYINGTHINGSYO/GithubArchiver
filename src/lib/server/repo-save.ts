import { archiveRepo, getArchiveConfigFromEnv } from '$lib/server/archiver';
import { getRepoBySlug, insertRepo, saveEnrichment, type RepoRow } from '$lib/server/db';
import { appendRepoEvent } from '$lib/server/events';
import { applyRepoIntelligence } from '$lib/server/apply-repo-intelligence';
import { enrichRepo, refreshRepo } from '$lib/server/enrich';
import {
	GitHubNotFoundError,
	GitHubRateLimitError,
	fetchRepoMetadata
} from '$lib/server/github';
import { parseGithubRepoRef } from '$lib/repo-ref';
import type { DiscoverySource, EnrichmentData } from '$lib/server/db/types';

export type SaveRepoSource = Extract<DiscoverySource, 'manual' | 'trending'>;

export interface RepoLookupResult {
	found: boolean;
	source: 'local' | 'github' | 'none';
	owner?: string;
	name?: string;
	full_name?: string;
	github_url?: string;
	description?: string | null;
	language?: string | null;
	stars?: number | null;
	forks?: number | null;
	topics?: string[];
	saved?: boolean;
	deleted_at?: string | null;
	message?: string;
}

export interface SaveRepoResult {
	ok: boolean;
	status: 'created' | 'updated' | 'exists' | 'error';
	owner: string;
	name: string;
	full_name: string;
	path: string;
	archived: boolean;
	message: string;
	error?: string;
}

function toEnrichment(data: Awaited<ReturnType<typeof fetchRepoMetadata>>): EnrichmentData {
	return {
		default_branch: data.default_branch,
		description: data.description,
		language: data.language,
		stars: data.stars,
		forks: data.forks,
		watchers: data.watchers,
		open_issues: data.open_issues,
		size: data.size,
		homepage: data.homepage,
		visibility: data.visibility,
		owner_avatar_url: data.owner_avatar_url,
		owner_type: data.owner_type,
		license: data.license,
		topics: data.topics,
		pushed_at: data.pushed_at,
		updated_at: data.updated_at
	};
}

export async function lookupRepo(input: string): Promise<RepoLookupResult> {
	const ref = parseGithubRepoRef(input);
	if (!ref) {
		return {
			found: false,
			source: 'none',
			message: 'Enter owner/name or a GitHub URL (example: vercel/next.js).'
		};
	}

	const local = getRepoBySlug(ref.owner, ref.name);
	if (local) {
		return {
			found: true,
			source: 'local',
			owner: local.owner,
			name: local.name,
			full_name: local.full_name,
			github_url: local.github_url,
			description: local.description,
			language: local.language,
			stars: local.stars,
			forks: local.forks,
			topics: local.topics ? (JSON.parse(local.topics) as string[]) : [],
			saved: true,
			deleted_at: local.deleted_at
		};
	}

	try {
		const meta = await fetchRepoMetadata(ref.owner, ref.name);
		return {
			found: true,
			source: 'github',
			owner: meta.owner,
			name: meta.name,
			full_name: meta.full_name,
			github_url: `https://github.com/${meta.full_name}`,
			description: meta.description,
			language: meta.language,
			stars: meta.stars,
			forks: meta.forks,
			topics: meta.topics,
			saved: false
		};
	} catch (err) {
		if (err instanceof GitHubNotFoundError) {
			return {
				found: false,
				source: 'none',
				owner: ref.owner,
				name: ref.name,
				message: `Repository ${ref.owner}/${ref.name} was not found on GitHub.`
			};
		}
		if (err instanceof GitHubRateLimitError) {
			return {
				found: false,
				source: 'none',
				message: 'GitHub rate limit hit — try again in a few minutes.'
			};
		}
		throw err;
	}
}

async function insertFromMetadata(
	meta: Awaited<ReturnType<typeof fetchRepoMetadata>>,
	source: SaveRepoSource
): Promise<RepoRow> {
	const now = new Date().toISOString();
	const createdAt = meta.created_at ?? meta.pushed_at ?? now;
	const insert = insertRepo({
		owner: meta.owner,
		name: meta.name,
		full_name: meta.full_name,
		github_url: `https://github.com/${meta.full_name}`,
		event_id: `${source}:${meta.full_name}:${now}`,
		created_at: createdAt,
		first_seen_at: now,
		discovery_source: source
	});

	const row =
		insert.id != null
			? getRepoBySlug(meta.owner, meta.name)
			: getRepoBySlug(meta.owner, meta.name);
	if (!row) throw new Error(`Failed to create ${meta.full_name}`);

	if (insert.status === 'inserted') {
		appendRepoEvent(row.id, 'first_seen', {
			source,
			full_name: meta.full_name,
			stars: meta.stars
		});
	}

	const enrichment = toEnrichment(meta);
	saveEnrichment(row.id, enrichment);
	applyRepoIntelligence(row, enrichment);

	return getRepoBySlug(meta.owner, meta.name) ?? row;
}

export async function saveRepoFromInput(
	input: string,
	opts: { archive?: boolean; source?: SaveRepoSource } = {}
): Promise<SaveRepoResult> {
	const source = opts.source ?? 'manual';
	const ref = parseGithubRepoRef(input);
	if (!ref) {
		return {
			ok: false,
			status: 'error',
			owner: '',
			name: '',
			full_name: '',
			path: '/',
			archived: false,
			message: 'Enter owner/name or a GitHub URL.',
			error: 'invalid_ref'
		};
	}

	try {
		let repo = getRepoBySlug(ref.owner, ref.name);
		let status: SaveRepoResult['status'] = 'exists';

		if (!repo) {
			const meta = await fetchRepoMetadata(ref.owner, ref.name);
			repo = await insertFromMetadata(meta, source);
			status = 'created';
		} else if (repo.enriched_at) {
			await refreshRepo(repo);
			repo = getRepoBySlug(repo.owner, repo.name) ?? repo;
			status = 'updated';
		} else {
			await enrichRepo(repo);
			repo = getRepoBySlug(repo.owner, repo.name) ?? repo;
			status = 'updated';
		}

		let archived = false;
		if (opts.archive) {
			const fresh = getRepoBySlug(repo.owner, repo.name) ?? repo;
			if (fresh.default_branch) {
				const result = await archiveRepo(fresh, getArchiveConfigFromEnv(), {
					captureReason: source === 'manual' ? 'manual_save' : 'trending'
				});
				archived = result.readme !== 'missing' || result.source !== 'missing' || result.zip !== 'missing';
			}
		}

		return {
			ok: true,
			status,
			owner: repo.owner,
			name: repo.name,
			full_name: repo.full_name,
			path: `/repo/${repo.owner}/${repo.name}`,
			archived,
			message:
				status === 'created'
					? archived
						? 'Saved and archived.'
						: 'Saved to the archive catalog.'
					: archived
						? 'Updated and archived.'
						: 'Updated from GitHub.'
		};
	} catch (err) {
		if (err instanceof GitHubNotFoundError) {
			return {
				ok: false,
				status: 'error',
				owner: ref.owner,
				name: ref.name,
				full_name: `${ref.owner}/${ref.name}`,
				path: `/`,
				archived: false,
				message: `Repository ${ref.owner}/${ref.name} was not found on GitHub.`,
				error: 'not_found'
			};
		}
		if (err instanceof GitHubRateLimitError) {
			return {
				ok: false,
				status: 'error',
				owner: ref.owner,
				name: ref.name,
				full_name: `${ref.owner}/${ref.name}`,
				path: `/`,
				archived: false,
				message: 'GitHub rate limit hit — try again shortly.',
				error: 'rate_limited'
			};
		}
		return {
			ok: false,
			status: 'error',
			owner: ref.owner,
			name: ref.name,
			full_name: `${ref.owner}/${ref.name}`,
			path: `/`,
			archived: false,
			message: err instanceof Error ? err.message : String(err),
			error: 'failed'
		};
	}
}
