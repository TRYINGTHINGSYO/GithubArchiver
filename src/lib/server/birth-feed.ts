import {
	countArchiveSnapshotFiles,
	countReposByDiscoverySource,
	parseTopics,
	queryBirthFeed,
	sumArchiveSnapshotBytes,
	type BirthFeedQuery
} from '$lib/server/db/birth-feed';
import { momentTag, velocityIndicator } from '$lib/server/intelligence';
import { getRepoZipDownloadUrl } from '$lib/server/source-zip';

export interface BirthFeedItem {
	id: number;
	owner: string;
	name: string;
	full_name: string;
	github_url: string;
	created_at: string;
	first_seen_at: string;
	discovery_source: string;
	description: string | null;
	summary: string | null;
	category: string | null;
	language: string | null;
	license: string | null;
	stars: number | null;
	forks: number | null;
	pushed_at: string | null;
	updated_at: string | null;
	last_checked_at: string | null;
	topics: string[];
	enriched: boolean;
	archived: boolean;
	has_readme: boolean;
	has_release: boolean;
	has_source: boolean;
	download_zip_url: string | null;
	moment_tag: string;
	velocity: 'up' | 'down' | 'flat';
}

export interface BirthFeedOptions extends BirthFeedQuery {}

export function listBirthFeed(opts: BirthFeedOptions = {}) {
	const result = queryBirthFeed(opts);

	return {
		...result,
		repos: result.repos.map((row) => ({
			id: row.id,
			owner: row.owner,
			name: row.name,
			full_name: row.full_name,
			github_url: row.github_url,
			created_at: row.created_at,
			first_seen_at: row.first_seen_at,
			discovery_source: row.discovery_source,
			description: row.description,
			language: row.language,
			license: row.license,
			stars: row.stars,
			forks: row.forks,
			pushed_at: row.pushed_at,
			updated_at: row.updated_at,
			last_checked_at: row.last_checked_at,
			summary: row.summary,
			category: row.category,
			topics: parseTopics(row.topics),
			enriched: row.is_enriched === 1,
			archived: row.is_archived === 1,
			has_readme: row.has_readme === 1,
			has_release: row.has_release === 1,
			has_source: row.has_source === 1,
			download_zip_url: row.has_source === 1 ? getRepoZipDownloadUrl(row.owner, row.name, row.id) : null,
			moment_tag: momentTag(row),
			velocity: velocityIndicator(row)
		})) satisfies BirthFeedItem[]
	};
}

export function getBirthFeedSources(): string[] {
	return ['gharchive', 'github_search'];
}

export function countGithubSearchRepos(): number {
	return countReposByDiscoverySource('github_search');
}

export function getArchiveDiskUsage() {
	return {
		file_count: countArchiveSnapshotFiles(),
		indexed_bytes: sumArchiveSnapshotBytes()
	};
}

export function parseBirthFeedParams(url: URL): BirthFeedOptions {
	const source = url.searchParams.get('source');
	return {
		source: source === 'gharchive' || source === 'github_search' ? source : undefined,
		language: url.searchParams.get('language') || undefined,
		archivedOnly: url.searchParams.get('archived_only') === '1',
		hasReadme: url.searchParams.get('has_readme') === '1',
		hasRelease: url.searchParams.get('has_release') === '1',
		page: Number(url.searchParams.get('page') ?? 1),
		perPage: Number(url.searchParams.get('per_page') ?? 50)
	};
}
