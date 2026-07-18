export interface RepoRow {
	id: number;
	owner: string;
	name: string;
	full_name: string;
	github_url: string;
	event_id: string;
	created_at: string;
	first_seen_at: string;
	default_branch: string | null;
	description: string | null;
	language: string | null;
	stars: number | null;
	forks: number | null;
	watchers: number | null;
	license: string | null;
	topics: string | null;
	pushed_at: string | null;
	updated_at: string | null;
	enriched_at: string | null;
	deleted_at: string | null;
	github_archived: number;
	last_checked_at: string | null;
	open_issues: number | null;
	size: number | null;
	discovery_source: string;
	homepage: string | null;
	visibility: string | null;
	owner_avatar_url: string | null;
	owner_type: string | null;
	summary: string | null;
	summary_generated_at: string | null;
	category: string | null;
	category_confidence: number | null;
	classified_at: string | null;
	interesting_score: number | null;
	signal_tier: string | null;
	scored_at: string | null;
	cluster_version: number | null;
	clustered_at: string | null;
	story_facts_json: string | null;
	story_text: string | null;
	story_version: number | null;
	story_generated_at: string | null;
	enrichment_level: number;
	enrichment_status?: string;
	enrichment_priority?: number;
	enrichment_tier?: string;
	enrichment_depth?: string;
	next_enrichment_at?: string | null;
	enrichment_attempts?: number;
	last_enrichment_error?: string | null;
	enrichment_claimed_by?: string | null;
	enrichment_claimed_at?: string | null;
	enrichment_claim_expires_at?: string | null;
	enrichment_etag?: string | null;
	last_enrichment_http_status?: number | null;
}

export type DiscoverySource = 'gharchive' | 'github_search' | 'manual' | 'trending';

export interface NewRepo {
	owner: string;
	name: string;
	full_name: string;
	github_url: string;
	event_id: string;
	created_at: string;
	first_seen_at: string;
	discovery_source?: DiscoverySource;
}

export interface EnrichmentData {
	default_branch: string | null;
	description: string | null;
	language: string | null;
	stars: number;
	forks: number;
	watchers: number;
	license: string | null;
	topics: string[];
	pushed_at: string | null;
	updated_at: string | null;
	open_issues?: number;
	size?: number;
	homepage?: string | null;
	visibility?: string | null;
	owner_avatar_url?: string | null;
	owner_type?: string | null;
}

export interface RepoQuery {
	q?: string;
	language?: string;
	neverEnriched?: boolean;
	feed?: string;
	sort?: string;
	source?: string;
	year?: number;
	dateFrom?: string;
	dateTo?: string;
	archivedOnly?: boolean;
	hasReadme?: boolean;
	hasRelease?: boolean;
	deletedOnly?: boolean;
	includeDeleted?: boolean;
	minStars?: number;
	maxStars?: number;
	minForks?: number;
	category?: string;
	signalTier?: string;
	minInterestingScore?: number;
	cluster?: string;
	clusters?: string[];
	clusterMatch?: 'any' | 'all';
	minClusterConfidence?: number;
	page?: number;
	perPage?: number;
}

export interface RepoQueryResult {
	repos: RepoRow[];
	total: number;
	page: number;
	perPage: number;
	totalPages: number;
}

export interface ArchiveSnapshotRow {
	id: number;
	repo_id: number;
	snapshot_type: 'readme' | 'source' | 'zip';
	file_path: string;
	file_size: number;
	sha256: string;
	head_sha: string | null;
	archived_at: string;
	capture_reason: string;
}

export interface NewArchiveSnapshot {
	repo_id: number;
	snapshot_type: 'readme' | 'source' | 'zip';
	file_path: string;
	file_size: number;
	sha256: string;
	head_sha: string | null;
	archived_at: string;
	capture_reason?: string;
}

export interface ReleaseInput {
	github_release_id: number | null;
	tag: string;
	name: string | null;
	published_at: string | null;
	prerelease: boolean;
	draft: boolean;
	body: string | null;
	tarball_url: string | null;
	zipball_url: string | null;
	assets: {
		github_asset_id: number;
		name: string;
		size: number;
		download_count: number;
		content_type: string | null;
		browser_download_url: string | null;
	}[];
}

export interface ReleaseRow {
	id: number;
	repo_id: number;
	github_release_id: number | null;
	tag: string;
	name: string | null;
	published_at: string | null;
	prerelease: number;
	draft: number;
	body: string | null;
	tarball_url: string | null;
	zipball_url: string | null;
	first_seen_at: string;
}

export interface ReleaseAssetRow {
	id: number;
	release_id: number;
	github_asset_id: number;
	name: string;
	size: number;
	download_count: number;
	content_type: string | null;
	browser_download_url: string | null;
}

export interface RepoEventRow {
	id: number;
	repo_id: number;
	event_type: string;
	event_time: string;
	payload_json: string;
}

export type JobType =
	| 'daemon'
	| 'ingest'
	| 'enrich'
	| 'refresh'
	| 'archive'
	| 'pipeline'
	| 'backup'
	| 'backfill'
	| 'maintenance'
	| 'export';
export type JobStatus = 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted';

export interface JobRunRow {
	id: number;
	job_type: JobType;
	status: JobStatus;
	started_at: string;
	finished_at: string | null;
	detail_json: string;
	error: string | null;
	reason: string | null;
}

export interface IngestionStateRow {
	hour_key: string;
	ingested_at: string;
	events: number;
	/** GH Archive matcher hits (repository births), not total parsed events. */
	matched_repo_creates: number;
	inserted: number;
	skipped: number;
	source: string;
	unavailable_at: string | null;
	http_status: number | null;
}

export interface MetricSnapshotRow {
	id: number;
	repo_id: number;
	stars: number;
	forks: number;
	watchers: number;
	open_issues: number;
	size: number;
	captured_at: string;
}

export interface MetricSnapshotInput {
	stars: number;
	forks: number;
	watchers: number;
	open_issues: number;
	size: number;
}

export interface RepoCommitSnapshotRow {
	id: number;
	repo_id: number;
	sha: string;
	tree_sha: string | null;
	parent_sha: string | null;
	committed_at: string | null;
	author_name: string | null;
	author_email: string | null;
	default_branch: string;
	observed_at: string;
}

export interface RepoLicenseHistoryRow {
	id: number;
	repo_id: number;
	license: string | null;
	observed_at: string;
}

export interface RepoTopicsHistoryRow {
	id: number;
	repo_id: number;
	topics_json: string;
	added_json: string | null;
	removed_json: string | null;
	observed_at: string;
}

export interface BackfillJobRow {
	id: number;
	start_date: string;
	end_date: string;
	source: string;
	max_hours_per_run: number;
	status: string;
	created_at: string;
	updated_at: string;
	last_error: string | null;
}

export interface BackfillHourRow {
	id: number;
	job_id: number;
	hour_key: string;
	year: number;
	date: string;
	status: string;
	source: string | null;
	events_parsed: number;
	repos_inserted: number;
	error: string | null;
	updated_at: string;
}

export interface SearchIngestStatRow {
	id: number;
	hour_key: string;
	query: string;
	shard_depth: number;
	shard_minutes: number | null;
	total_count: number | null;
	incomplete_results: number;
	pages_fetched: number;
	found: number;
	inserted: number;
	skipped: number;
	source: string;
	status: string;
	started_at: string;
	finished_at: string | null;
	error: string | null;
}
