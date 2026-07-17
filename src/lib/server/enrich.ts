import {
	insertMetricSnapshot,
	insertReleaseIfNew,
	markRepoDeleted,
	recordRepoRename,
	saveEnrichment,
	saveRefreshUpdate,
	setGithubArchived,
	type EnrichmentData,
	type MetricSnapshotInput,
	type RepoRow
} from '$lib/server/db';
import { enqueueRepoPipeline, setEnrichmentLevel } from '$lib/server/db/pipeline';
import { appendRepoEvent } from '$lib/server/events';
import {
	fetchReleases,
	fetchRepoMetadata,
	fetchTags
} from '$lib/server/github';
import {
	recordRepoHistoryChanges,
	stripHistoryTrackedChanges
} from '$lib/server/record-repo-history';
import { applyRepoIntelligence } from '$lib/server/apply-repo-intelligence';

/** Enrichment tiers — Level 1 is the default for backlog throughput. */
export type EnrichmentLevel = 1 | 2 | 3;

export interface EnrichRepoOptions {
	/** Target enrichment level. Level 1 = GitHub metadata only. */
	level?: EnrichmentLevel;
	/**
	 * Sync releases/tags (2 extra API calls). Off by default for Level 1
	 * to keep requests-per-repo near 1.
	 */
	syncReleases?: boolean;
}

export interface EnrichRepoResult {
	level: number;
	requests: number;
	syncedReleases: boolean;
}
const IMPORTANT_METADATA_FIELDS: (keyof EnrichmentData)[] = [
	'default_branch',
	'description',
	'language',
	'license',
	'pushed_at',
	'updated_at'
];

const METRIC_FIELDS = ['stars', 'forks', 'watchers', 'open_issues', 'size'] as const;

function fieldChanges<T extends string>(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	fields: readonly T[]
): Record<string, { old: unknown; new: unknown }> {
	const changes: Record<string, { old: unknown; new: unknown }> = {};
	for (const field of fields) {
		const oldVal = before[field];
		const newVal = after[field];
		if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
			changes[field] = { old: oldVal ?? null, new: newVal ?? null };
		}
	}
	return changes;
}

function importantMetadataChanges(
	before: RepoRow,
	after: EnrichmentData
): Record<string, { old: unknown; new: unknown }> {
	const changes = fieldChanges(
		before as unknown as Record<string, unknown>,
		after as unknown as Record<string, unknown>,
		IMPORTANT_METADATA_FIELDS
	);

	const oldTopics = before.topics ? (JSON.parse(before.topics) as string[]) : [];
	if (JSON.stringify(oldTopics) !== JSON.stringify(after.topics)) {
		changes.topics = { old: oldTopics, new: after.topics };
	}

	return changes;
}

function metadataChangesForEvent(
	before: RepoRow,
	after: EnrichmentData
): Record<string, { old: unknown; new: unknown }> {
	return stripHistoryTrackedChanges(importantMetadataChanges(before, after));
}

function metricChanges(
	before: RepoRow,
	after: EnrichmentData
): Record<string, { old: unknown; new: unknown }> {
	return fieldChanges(
		{
			stars: before.stars,
			forks: before.forks,
			watchers: before.watchers,
			open_issues: before.open_issues,
			size: before.size
		},
		{
			stars: after.stars,
			forks: after.forks,
			watchers: after.watchers,
			open_issues: after.open_issues ?? null,
			size: after.size ?? null
		},
		METRIC_FIELDS
	);
}

function toEnrichmentData(data: Awaited<ReturnType<typeof fetchRepoMetadata>>): EnrichmentData {
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

function toMetricInput(data: EnrichmentData): MetricSnapshotInput {
	return {
		stars: data.stars,
		forks: data.forks,
		watchers: data.watchers,
		open_issues: data.open_issues ?? 0,
		size: data.size ?? 0
	};
}

async function applyRenameAndArchive(
	repo: RepoRow,
	data: Awaited<ReturnType<typeof fetchRepoMetadata>>
): Promise<RepoRow> {
	if (data.full_name !== repo.full_name) {
		const [newOwner, newName] = data.full_name.split('/');
		recordRepoRename(repo.id, repo.full_name, data.full_name, newOwner, newName);
		appendRepoEvent(repo.id, 'renamed', {
			old_full_name: repo.full_name,
			new_full_name: data.full_name
		});
		repo = { ...repo, owner: newOwner, name: newName, full_name: data.full_name };
	}

	const wasArchived = repo.github_archived === 1;
	if (data.archived && !wasArchived) {
		setGithubArchived(repo.id, true);
		appendRepoEvent(repo.id, 'archived', { github_archived: true });
	} else if (!data.archived && wasArchived) {
		setGithubArchived(repo.id, false);
		appendRepoEvent(repo.id, 'unarchived', { github_archived: false });
	}

	return repo;
}

async function syncReleasesForRepo(repo: RepoRow): Promise<number> {
	const [releases, tags] = await Promise.all([
		fetchReleases(repo.owner, repo.name),
		fetchTags(repo.owner, repo.name)
	]);

	const releaseTags = new Set(releases.map((r) => r.tag_name));
	let newCount = 0;

	for (const release of releases) {
		const releaseId = insertReleaseIfNew(repo.id, {
			github_release_id: release.id,
			tag: release.tag_name,
			name: release.name,
			published_at: release.published_at,
			prerelease: release.prerelease,
			draft: release.draft,
			body: release.body,
			tarball_url: release.tarball_url,
			zipball_url: release.zipball_url,
			assets: release.assets.map((a) => ({
				github_asset_id: a.id,
				name: a.name,
				size: a.size,
				download_count: a.download_count,
				content_type: a.content_type,
				browser_download_url: a.browser_download_url
			}))
		});

		if (releaseId) {
			newCount++;
			appendRepoEvent(
				repo.id,
				'release_detected',
				{
					tag: release.tag_name,
					name: release.name,
					published_at: release.published_at,
					release_id: releaseId
				},
				release.published_at ?? undefined
			);
		}
	}

	for (const tag of tags) {
		if (releaseTags.has(tag.name)) continue;
		const releaseId = insertReleaseIfNew(repo.id, {
			github_release_id: null,
			tag: tag.name,
			name: tag.name,
			published_at: null,
			prerelease: false,
			draft: false,
			body: null,
			tarball_url: null,
			zipball_url: null,
			assets: []
		});
		if (releaseId) {
			newCount++;
			appendRepoEvent(repo.id, 'release_detected', {
				tag: tag.name,
				name: tag.name,
				published_at: null,
				release_id: releaseId,
				source: 'tag'
			});
		}
	}

	return newCount;
}

export async function enrichRepo(repo: RepoRow, opts: EnrichRepoOptions = {}): Promise<EnrichRepoResult> {
	const level = opts.level ?? 1;
	const syncReleases = opts.syncReleases ?? false;
	let requests = 0;

	const data = await fetchRepoMetadata(repo.owner, repo.name);
	requests += 1;
	repo = await applyRenameAndArchive(repo, data);

	const enrichment = toEnrichmentData(data);
	const wasEnriched = repo.enriched_at !== null;
	const observedAt = new Date().toISOString();

	await recordRepoHistoryChanges(repo, enrichment, observedAt);

	const metadataDelta = metadataChangesForEvent(repo, enrichment);

	saveEnrichment(repo.id, enrichment);
	setEnrichmentLevel(repo.id, Math.max(1, level));
	applyRepoIntelligence(repo, enrichment);

	// Classification + scoring run inline; queue clustering and stories for
	// changed IDs instead of rescanning the whole table later.
	enqueueRepoPipeline(repo.id, {
		needsClassification: false,
		needsScoring: false,
		needsClustering: true,
		needsStory: true
	});

	if (wasEnriched && Object.keys(metadataDelta).length > 0) {
		appendRepoEvent(repo.id, 'metadata_updated', {
			changes: metadataDelta,
			updated_at: data.updated_at
		});
	}

	if (syncReleases) {
		await syncReleasesForRepo(repo);
		requests += 2;
	}

	// Levels 2–3 (README / source) stay in the archive worker so Level 1
	// enrichment can run at ~1 request per repository.
	return { level: Math.max(1, level), requests, syncedReleases: syncReleases };
}

export async function refreshRepo(repo: RepoRow): Promise<{ metricsChanged: boolean }> {
	const data = await fetchRepoMetadata(repo.owner, repo.name);
	repo = await applyRenameAndArchive(repo, data);

	const enrichment = toEnrichmentData(data);
	const observedAt = new Date().toISOString();

	await recordRepoHistoryChanges(repo, enrichment, observedAt);

	const metadataDelta = metadataChangesForEvent(repo, enrichment);
	const metricsDelta = metricChanges(repo, enrichment);

	saveRefreshUpdate(repo.id, enrichment);
	insertMetricSnapshot(repo.id, toMetricInput(enrichment));
	applyRepoIntelligence(repo, enrichment);
	enqueueRepoPipeline(repo.id, {
		needsClassification: false,
		needsScoring: false,
		needsClustering: true,
		needsStory: true
	});

	if (Object.keys(metadataDelta).length > 0) {
		appendRepoEvent(repo.id, 'metadata_updated', {
			changes: metadataDelta,
			updated_at: data.updated_at
		});
	}

	if (Object.keys(metricsDelta).length > 0) {
		appendRepoEvent(repo.id, 'metrics_updated', {
			changes: metricsDelta,
			captured_at: new Date().toISOString()
		});
	}

	await syncReleasesForRepo(repo);
	return { metricsChanged: Object.keys(metricsDelta).length > 0 };
}

export async function handleRepoNotFound(repo: RepoRow): Promise<void> {
	markRepoDeleted(repo.id);
	appendRepoEvent(repo.id, 'deleted', { full_name: repo.full_name });
}

export async function handleEnrichmentFailed(repo: RepoRow, reason: string): Promise<void> {
	appendRepoEvent(repo.id, 'enrichment_failed', { reason, full_name: repo.full_name });
}
