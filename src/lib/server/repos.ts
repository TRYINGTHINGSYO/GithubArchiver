import {
	countRepos,
	countUnenriched,
	getArchiveSnapshotById,
	getRepoBySlug,
	listArchiveSnapshots,
	listLanguages,
	listMetricSnapshots,
	listRepoReleaseAssets,
	listRepoReleases,
	parseTopics,
	queryRepos,
	type ArchiveSnapshotRow,
	type MetricSnapshotRow,
	type ReleaseAssetRow,
	type ReleaseRow,
	type RepoRow
} from '$lib/server/db';
import { getRepoFavorite } from '$lib/server/db/favorites';
import { renderMarkdownSafe } from '$lib/server/markdown';
import { enrichSnapshotMeta, readSnapshotText } from '$lib/server/snapshots';
import type { SourceAnalysis } from '$lib/server/source-archive';
import { getRepoZipDownloadUrl } from '$lib/server/source-zip';
import { momentTag, velocityIndicator } from '$lib/server/intelligence';
import {
	evidenceGroupAnchor,
	groupEvidenceReferences,
	type EvidenceCategory,
	type EvidenceExplorerGroup,
	type EvidenceReference
} from '$lib/evidence';
import {
	eventLabel,
	listRepoEvents,
	parseEventPayload,
	type RepoEventRow,
	type RepoEventType
} from '$lib/server/events';
import { getDb } from '$lib/server/db/connection';
import { isMetadataOnlyMode } from '$lib/server/runtime-mode';

export interface RepoArchiveBadges {
	preserved: boolean;
	readmeSaved: boolean;
	sourceSaved: boolean;
	storyReady: boolean;
	deletedButSaved: boolean;
	metadataOnly: boolean;
}

export interface RepoSummary {
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
	topics: string[];
	pushed_at: string | null;
	updated_at: string | null;
	enriched_at: string | null;
	deleted_at: string | null;
	github_archived: boolean;
	is_enriched: boolean;
	last_checked_at: string | null;
	open_issues: number | null;
	size: number | null;
	discovery_source: string;
	homepage: string | null;
	visibility: string;
	owner_avatar_url: string;
	owner_type: string | null;
	moment_tag: string;
	velocity: 'up' | 'down' | 'flat';
	summary: string | null;
	summary_generated_at: string | null;
	category: string | null;
	category_confidence: number | null;
	classified_at: string | null;
	search_snippet?: string | null;
	search_rank?: number | null;
	download_zip_url?: string | null;
	archive_badges: RepoArchiveBadges;
	archive_storage_disabled: boolean;
	is_favorite: boolean;
	favorited_at: string | null;
}

function getRepoArchiveBadges(repoId: number, deletedAt: string | null): RepoArchiveBadges {
	const db = getDb();
	const row = db
		.prepare(
			`SELECT
				EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = ?) AS preserved,
				EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = ? AND a.snapshot_type = 'readme') AS readme_saved,
				EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = ? AND a.snapshot_type = 'source') AS source_saved,
				EXISTS (SELECT 1 FROM archive_snapshots a WHERE a.repo_id = ?)
				  OR EXISTS (SELECT 1 FROM releases rl WHERE rl.repo_id = ?)
				  OR EXISTS (SELECT 1 FROM repository_events e WHERE e.repo_id = ? AND e.event_type IN ('readme_changed', 'snapshot_created', 'release_detected', 'deleted'))
				  AS story_ready`
		)
		.get(repoId, repoId, repoId, repoId, repoId, repoId) as {
			preserved: 0 | 1;
			readme_saved: 0 | 1;
			source_saved: 0 | 1;
			story_ready: 0 | 1;
	};
	const metadataOnly = isMetadataOnlyMode();
	return {
		preserved: metadataOnly ? false : row.preserved === 1,
		readmeSaved: metadataOnly ? false : row.readme_saved === 1,
		sourceSaved: metadataOnly ? false : row.source_saved === 1,
		storyReady: row.story_ready === 1,
		deletedButSaved: metadataOnly ? false : Boolean(deletedAt && row.preserved === 1),
		metadataOnly
	};
}

function toSummary(row: RepoRow & { fts_snippet?: string | null; fts_rank?: number | null }): RepoSummary {
	const favorite = getRepoFavorite(row.id);
	return {
		id: row.id,
		owner: row.owner,
		name: row.name,
		full_name: row.full_name,
		github_url: row.github_url,
		event_id: row.event_id,
		created_at: row.created_at,
		first_seen_at: row.first_seen_at,
		default_branch: row.default_branch,
		description: row.description,
		language: row.language,
		stars: row.stars,
		forks: row.forks,
		watchers: row.watchers,
		license: row.license,
		topics: parseTopics(row.topics),
		pushed_at: row.pushed_at,
		updated_at: row.updated_at,
		enriched_at: row.enriched_at,
		deleted_at: row.deleted_at,
		github_archived: row.github_archived === 1,
		is_enriched: row.enriched_at !== null,
		last_checked_at: row.last_checked_at,
		open_issues: row.open_issues,
		size: row.size,
		discovery_source: row.discovery_source,
		homepage: row.homepage,
		visibility: row.visibility ?? 'public',
		owner_avatar_url: row.owner_avatar_url ?? `https://github.com/${row.owner}.png?size=120`,
		owner_type: row.owner_type,
		moment_tag: momentTag(row),
		velocity: velocityIndicator(row),
		summary: row.summary ?? null,
		summary_generated_at: row.summary_generated_at ?? null,
		category: row.category ?? null,
		category_confidence: row.category_confidence ?? null,
		classified_at: row.classified_at ?? null,
		search_snippet: row.fts_snippet ?? null,
		search_rank: row.fts_rank ?? null,
		download_zip_url: getRepoZipDownloadUrl(row.owner, row.name, row.id),
		archive_badges: getRepoArchiveBadges(row.id, row.deleted_at),
		archive_storage_disabled: isMetadataOnlyMode(),
		is_favorite: Boolean(favorite),
		favorited_at: favorite?.favorited_at ?? null
	};
}

export interface ListReposOptions {
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
	minStars?: number;
	minForks?: number;
	page?: number;
	perPage?: number;
}

export function listRepos(opts: ListReposOptions = {}) {
	const result = queryRepos({
		q: opts.q,
		language: opts.language,
		neverEnriched: opts.neverEnriched,
		feed: opts.feed,
		sort: opts.sort,
		source: opts.source,
		year: opts.year,
		dateFrom: opts.dateFrom,
		dateTo: opts.dateTo,
		archivedOnly: opts.archivedOnly,
		hasReadme: opts.hasReadme,
		hasRelease: opts.hasRelease,
		deletedOnly: opts.deletedOnly,
		includeDeleted: opts.deletedOnly,
		minStars: opts.minStars,
		minForks: opts.minForks,
		page: opts.page,
		perPage: opts.perPage
	});

	return {
		...result,
		repos: result.repos.map(toSummary),
		search_mode: opts.q?.trim() ? ('fts' as const) : ('list' as const)
	};
}

export function getRepoStats() {
	return {
		total: countRepos(),
		unenriched: countUnenriched()
	};
}

export function getAvailableLanguages() {
	return listLanguages();
}

export interface ArchiveSnapshot {
	id: number;
	snapshot_type: 'readme' | 'source' | 'zip';
	file_path: string;
	file_size: number;
	sha256: string;
	head_sha: string | null;
	archived_at: string;
	file_exists: boolean;
	download_url: string;
}

function toArchiveSnapshot(row: ArchiveSnapshotRow): ArchiveSnapshot {
	return enrichSnapshotMeta(row);
}

export interface TimelineEvent {
	id: number;
	event_type: RepoEventType;
	event_time: string;
	label: string;
	payload: Record<string, unknown>;
}

export interface ReadmeImage {
	alt: string;
	src: string;
	raw_src: string;
}

export interface ProfileLink {
	type: string;
	label: string;
	url: string;
}

export interface ReleaseWithAssets extends ReleaseRow {
	assets: ReleaseAssetRow[];
	body_html: string | null;
}

export interface HealthScore {
	score: number;
	label: string;
	factors: { label: string; value: number; detail: string }[];
}

export interface ProfileSummary {
	definition: string;
	use_case: string;
	stack_guess: string;
	maturity_signal: string;
}

export interface ProjectSignal {
	score: number;
	label: string;
	breakdown: {
		activity: number;
		documentation: number;
		maintenance: number;
		popularity: number;
		freshness: number;
	};
	explanation: string;
}

export interface ActivitySummary {
	metrics: MetricSnapshotRow[];
	stars_delta: number | null;
	forks_delta: number | null;
	watchers_delta: number | null;
	open_issues_delta: number | null;
	repository_age_days: number;
	last_push_days: number | null;
}

export interface TechnologyInsight {
	name: string;
	detail: string;
	source: 'metadata' | 'readme' | 'source';
}

export interface LocalArchiveSummary {
	readme_archived: boolean;
	source_archived: boolean;
	metadata_only: boolean;
	total_snapshots: number;
	total_bytes: number;
	last_snapshot_at: string | null;
	readme_count: number;
	source_count: number;
}

export interface ArchiveEvidenceItem {
	label: string;
	value: string;
	detail: string;
	status: 'saved' | 'partial' | 'missing' | 'disabled';
	evidenceIds: string[];
	evidenceTarget: string;
}

export interface ArchiveScoreFactor {
	label: string;
	weight: number;
	earned: number;
	detail: string;
	evidenceIds: string[];
	evidenceTarget: string;
}

export interface ArchiveScore {
	score: number;
	label: string;
	reasons: string[];
	warnings: string[];
	factors: ArchiveScoreFactor[];
}

export interface RecoverabilityItem {
	label: string;
	score: number;
	detail: string;
	evidenceIds: string[];
	evidenceTarget: string;
}

export interface RecoverabilityReport {
	overall: number;
	items: RecoverabilityItem[];
}

export interface ArchiveStoryStep {
	label: string;
	date: string;
	detail: string;
	tone: 'neutral' | 'saved' | 'warning';
	evidenceIds: string[];
	evidenceTarget: string;
}

export interface RepositoryIntelligenceReport {
	identity: string;
	purpose: string;
	whyArchive: string;
	currentStatus: string;
	evidence: ArchiveEvidenceItem[];
	archiveScore: ArchiveScore;
	recoverability: RecoverabilityReport;
	story: string[];
	storyTimeline: ArchiveStoryStep[];
	storyTakeaway: string[];
	evidenceReferences: EvidenceReference[];
	evidenceGroups: EvidenceExplorerGroup[];
}

export interface MergedTimelineItem {
	type: string;
	label: string;
	time: string;
	detail: string | null;
}

export interface SourceTruthNotice {
	type: 'stale_archive' | 'deleted_with_archive' | 'archived_with_snapshots';
	message: string;
}

export function getRepoTimeline(owner: string, name: string, limit = 200) {
	const row = getRepoBySlug(owner, name);
	if (!row) return null;

	const events = listRepoEvents(row.id, limit).map((e) => toTimelineEvent(e));
	const snapshots = listArchiveSnapshots(row.id).map(toArchiveSnapshot);
	const releases = listRepoReleases(row.id);

	return {
		repo: toSummary(row),
		events,
		snapshots,
		releases
	};
}

function toTimelineEvent(row: RepoEventRow): TimelineEvent {
	return {
		id: row.id,
		event_type: row.event_type,
		event_time: row.event_time,
		label: eventLabel(row.event_type as RepoEventType),
		payload: parseEventPayload(row.payload_json)
	};
}

function resolveReadmeAssetUrl(src: string, repo: RepoSummary): string {
	if (/^https?:\/\//i.test(src) || src.startsWith('data:')) return src;
	const branch = repo.default_branch ?? 'HEAD';
	const normalized = src.replace(/^\.\//, '').replace(/^\/+/, '');
	return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${branch}/${normalized}`;
}

function resolveReadmeLinkUrl(href: string, repo: RepoSummary): string {
	if (/^(https?:|mailto:|tel:|#)/i.test(href)) return href;
	const branch = repo.default_branch ?? 'HEAD';
	const normalized = href.replace(/^\.\//, '').replace(/^\/+/, '');
	return `https://github.com/${repo.owner}/${repo.name}/blob/${branch}/${normalized}`;
}

function rewriteReadmeUrls(markdown: string, repo: RepoSummary): string {
	return markdown
		.replace(/!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (match, alt, src, title) => {
			if (!src || /^#/.test(src) || /^mailto:/i.test(src)) return match;
			return `![${alt}](${resolveReadmeAssetUrl(src, repo)}${title ?? ''})`;
		})
		.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (match, label, href, title) => {
			if (!href) return match;
			return `[${label}](${resolveReadmeLinkUrl(href, repo)}${title ?? ''})`;
		})
		.replace(/<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi, (_match, before, src, after) => {
			return `<img${before}src="${resolveReadmeAssetUrl(src, repo)}"${after}>`;
		})
		.replace(/<a\b([^>]*?)\bhref=["']([^"']+)["']([^>]*)>/gi, (_match, before, href, after) => {
			return `<a${before}href="${resolveReadmeLinkUrl(href, repo)}"${after}>`;
		});
}

function enhanceReadmeHtml(html: string): string {
	return html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
		let next = attrs as string;
		if (!/\bloading=/i.test(next)) next += ' loading="lazy"';
		if (!/\bdecoding=/i.test(next)) next += ' decoding="async"';
		if (!/\breferrerpolicy=/i.test(next)) next += ' referrerpolicy="no-referrer"';
		return `<img${next}>`;
	});
}

function extractReadmeImages(markdown: string, repo: RepoSummary): ReadmeImage[] {
	const images: ReadmeImage[] = [];
	const seen = new Set<string>();
	const markdownImage = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
	const htmlImage = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
	let match: RegExpExecArray | null;

	while ((match = markdownImage.exec(markdown))) {
		const raw = match[2];
		if (!raw || seen.has(raw)) continue;
		seen.add(raw);
		images.push({ alt: match[1] || 'README image', raw_src: raw, src: resolveReadmeAssetUrl(raw, repo) });
	}

	while ((match = htmlImage.exec(markdown))) {
		const raw = match[1];
		if (!raw || seen.has(raw)) continue;
		seen.add(raw);
		images.push({ alt: 'README image', raw_src: raw, src: resolveReadmeAssetUrl(raw, repo) });
	}

	return images.slice(0, 24);
}

function classifyLink(url: string): string {
	const host = (() => {
		try {
			return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
		} catch {
			return '';
		}
	})();
	if (host.includes('discord')) return 'Discord';
	if (host.includes('twitter') || host.includes('x.com')) return 'Twitter/X';
	if (host.includes('bsky.app') || host.includes('bluesky')) return 'Bluesky';
	if (host.includes('youtube') || host.includes('youtu.be')) return 'YouTube';
	if (host.includes('hub.docker.com')) return 'Docker Hub';
	if (host.includes('pypi.org')) return 'PyPI';
	if (host.includes('npmjs.com')) return 'NPM';
	if (host.includes('crates.io')) return 'Crates.io';
	if (host.includes('nuget.org')) return 'NuGet';
	if (host.includes('brew.sh')) return 'Homebrew';
	if (host.includes('docs.') || url.toLowerCase().includes('/docs')) return 'Documentation';
	if (host.includes('github.io') || host.includes('vercel.app') || host.includes('netlify.app')) return 'Website';
	return 'Link';
}

function isPromotableExternalLink(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (!['http:', 'https:'].includes(parsed.protocol)) return false;

	const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
	const path = parsed.pathname.toLowerCase();
	const imageLike = /\.(png|jpe?g|gif|webp|svg|avif|ico)(\?|$)/i.test(path);
	const badgeHosts = ['shields.io', 'badgen.net', 'github.com', 'raw.githubusercontent.com', 'user-images.githubusercontent.com'];
	const registryOrSocial =
		host.includes('discord') ||
		host.includes('twitter') ||
		host.includes('x.com') ||
		host.includes('bsky.app') ||
		host.includes('youtube') ||
		host.includes('youtu.be') ||
		host.includes('hub.docker.com') ||
		host.includes('pypi.org') ||
		host.includes('npmjs.com') ||
		host.includes('crates.io') ||
		host.includes('nuget.org') ||
		host.includes('brew.sh');

	if (imageLike || badgeHosts.some((badgeHost) => host === badgeHost || host.endsWith(`.${badgeHost}`))) {
		return registryOrSocial;
	}
	return true;
}

function extractLinks(markdown: string, repo: RepoSummary): ProfileLink[] {
	const links: ProfileLink[] = [];
	const seen = new Set<string>();
	if (repo.homepage) {
		links.push({ type: 'Website', label: repo.homepage, url: repo.homepage });
		seen.add(repo.homepage);
	}

	const patterns = [/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g, /\bhttps?:\/\/[^\s<>)"']+/g];
	for (const pattern of patterns) {
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(markdown))) {
			const url = (match[1] ?? match[0]).replace(/[.,;:]+$/, '');
			if (seen.has(url) || !isPromotableExternalLink(url)) continue;
			seen.add(url);
			links.push({ type: classifyLink(url), label: url.replace(/^https?:\/\//, ''), url });
		}
	}

	const priority = ['Website', 'Documentation', 'Discord', 'Twitter/X', 'Bluesky', 'YouTube', 'Docker Hub', 'PyPI', 'NPM', 'Crates.io', 'NuGet', 'Homebrew'];
	const rank = (type: string) => {
		const index = priority.indexOf(type);
		return index === -1 ? priority.length : index;
	};
	return links
		.sort((a, b) => rank(a.type) - rank(b.type))
		.slice(0, 18);
}

function readmeFeatureFlags(markdown: string) {
	return {
		tables: /\n\|.+\|\n\|[\s:-]+\|/.test(markdown),
		code_blocks: /```/.test(markdown),
		mermaid: /```\s*mermaid/i.test(markdown),
		math: /\$\$[\s\S]+?\$\$|\\\(|\\\[/.test(markdown),
		task_lists: /- \[[ x]\]/i.test(markdown),
		emoji: /:[a-z0-9_+-]+:/i.test(markdown) || /[\u{1f300}-\u{1faff}]/u.test(markdown),
		images: /!\[[^\]]*\]\(|<img\b/i.test(markdown)
	};
}

function buildTechnologyInsights(repo: RepoSummary, readmeText: string, source: SourceAnalysis | null): TechnologyInsight[] {
	const insights: TechnologyInsight[] = [];
	const add = (name: string, detail: string, sourceKind: TechnologyInsight['source']) => {
		if (!insights.some((item) => item.name === name)) {
			insights.push({ name, detail, source: sourceKind });
		}
	};
	const text = `${readmeText}\n${repo.topics.join(' ')}`.toLowerCase();

	if (repo.language) add(repo.language, 'Primary language from GitHub metadata', 'metadata');
	for (const topic of repo.topics.slice(0, 8)) add(topic, 'Repository topic', 'metadata');
	for (const signal of source?.signals ?? []) add(signal, 'Detected from archived source files', 'source');

	const readmeSignals: [RegExp, string, string][] = [
		[/\breact\b/, 'React', 'Mentioned in README'],
		[/\bsvelte\b/, 'Svelte', 'Mentioned in README'],
		[/\bvue\b/, 'Vue', 'Mentioned in README'],
		[/\bnext\.?js\b/, 'Next.js', 'Mentioned in README'],
		[/\bexpress\b/, 'Express', 'Mentioned in README'],
		[/\bpostgres|postgresql\b/, 'PostgreSQL', 'Mentioned in README'],
		[/\bsqlite\b/, 'SQLite', 'Mentioned in README'],
		[/\bdocker\b/, 'Docker', 'Mentioned in README'],
		[/\bkubernetes|k8s\b/, 'Kubernetes', 'Mentioned in README'],
		[/\baws\b/, 'AWS', 'Mentioned in README'],
		[/\bgcp|google cloud\b/, 'Google Cloud', 'Mentioned in README'],
		[/\bazure\b/, 'Azure', 'Mentioned in README']
	];
	for (const [pattern, name, detail] of readmeSignals) {
		if (pattern.test(text)) add(name, detail, 'readme');
	}

	return insights.slice(0, 24);
}

function buildProjectSignal(
	repo: RepoSummary,
	readmeText: string,
	snapshots: ArchiveSnapshot[],
	releases: ReleaseWithAssets[],
	metrics: MetricSnapshotRow[]
): ProjectSignal {
	const daysSincePush = repo.pushed_at
		? Math.floor((Date.now() - new Date(repo.pushed_at).getTime()) / 86_400_000)
		: null;
	const stars = repo.stars ?? 0;
	const latest = metrics[0] ?? null;
	const oldest = metrics.at(-1) ?? null;
	const starDelta = latest && oldest && latest.id !== oldest.id ? latest.stars - oldest.stars : 0;
	const hasReadme = readmeText.length > 0;
	const hasSource = snapshots.some((snapshot) => snapshot.snapshot_type === 'source' && snapshot.file_exists);
	const hasMaintenanceDocs = /contributing|code of conduct|security|dependabot|\.github\/workflows/i.test(readmeText);

	const activity =
		daysSincePush === null ? 8 : daysSincePush <= 30 ? 20 : daysSincePush <= 180 ? 14 : daysSincePush <= 365 ? 8 : 3;
	const documentation = (hasReadme ? 13 : 0) + (readmeText.length > 1200 ? 5 : 0) + (hasSource ? 2 : 0);
	const maintenance = (releases.length > 0 ? 8 : 0) + (repo.license ? 5 : 0) + (hasMaintenanceDocs ? 7 : 0);
	const popularity = Math.min(20, Math.round(Math.log10(stars + 1) * 6 + Math.max(0, starDelta)));
	const freshness = repo.last_checked_at
		? Math.max(0, 20 - Math.floor((Date.now() - new Date(repo.last_checked_at).getTime()) / 86_400_000))
		: repo.is_enriched
			? 8
			: 0;

	let score = activity + documentation + maintenance + popularity + freshness;
	if (repo.deleted_at || repo.github_archived) score = Math.min(score, 60);
	score = Math.max(0, Math.min(100, score));
	const label = score >= 80 ? 'Strong signal' : score >= 60 ? 'Good signal' : score >= 40 ? 'Mixed signal' : score >= 20 ? 'Weak signal' : 'Unknown signal';

	return {
		score,
		label,
		breakdown: { activity, documentation, maintenance, popularity, freshness },
		explanation: `Activity ${activity}, documentation ${documentation}, maintenance ${maintenance}, popularity ${popularity}, freshness ${freshness}.`
	};
}

function maturityLabel(repo: RepoSummary, releases: ReleaseWithAssets[]): string {
	if (repo.github_archived || repo.deleted_at) return 'Inactive or archived';
	if (releases.length >= 5 && (repo.stars ?? 0) > 100) return 'Mature';
	if (releases.length > 0 || (repo.stars ?? 0) > 100) return 'Established';
	if (repo.pushed_at && Date.now() - new Date(repo.pushed_at).getTime() < 90 * 86_400_000) return 'Active early-stage';
	return 'Unclear';
}

function buildProfileSummary(
	repo: RepoSummary,
	readmeText: string,
	releases: ReleaseWithAssets[],
	technologies: TechnologyInsight[]
): ProfileSummary {
	const techNames = technologies.slice(0, 5).map((item) => item.name);
	const description =
		repo.summary?.trim() ||
		repo.description ||
		`${repo.full_name} is a GitHub repository archived by GithubArchive+.`;
	const audience = /cli|command line|terminal/i.test(readmeText)
		? 'Developers and command-line users'
		: /api|sdk|library|package/i.test(readmeText)
			? 'Developers integrating a library or API'
			: /app|dashboard|ui|web/i.test(readmeText)
				? 'People evaluating an application or web project'
				: 'People researching this repository';
	const maturity = maturityLabel(repo, releases);
	return {
		definition: description,
		use_case: `Use-case: ${audience}.`,
		stack_guess: techNames.length
			? `Stack guess: ${techNames.join(', ')}.`
			: 'Stack guess: not enough README or source evidence yet.',
		maturity_signal: `Maturity signal: ${maturity}; ${releases.length ? `${releases.length} release/tag record(s) archived` : 'no release history archived'}.`
	};
}

function buildActivitySummary(repo: RepoSummary, metrics: MetricSnapshotRow[]): ActivitySummary {
	const latest = metrics[0] ?? null;
	const oldest = metrics.at(-1) ?? null;
	const delta = (key: 'stars' | 'forks' | 'watchers' | 'open_issues') =>
		latest && oldest && latest.id !== oldest.id ? latest[key] - oldest[key] : null;

	return {
		metrics,
		stars_delta: delta('stars'),
		forks_delta: delta('forks'),
		watchers_delta: delta('watchers'),
		open_issues_delta: delta('open_issues'),
		repository_age_days: Math.max(0, Math.floor((Date.now() - new Date(repo.created_at).getTime()) / 86_400_000)),
		last_push_days: repo.pushed_at ? Math.max(0, Math.floor((Date.now() - new Date(repo.pushed_at).getTime()) / 86_400_000)) : null
	};
}

function buildLocalArchiveSummary(snapshots: ArchiveSnapshot[], metadataOnly = false): LocalArchiveSummary {
	if (metadataOnly) {
		return {
			readme_archived: false,
			source_archived: false,
			metadata_only: true,
			total_snapshots: 0,
			total_bytes: 0,
			last_snapshot_at: null,
			readme_count: 0,
			source_count: 0
		};
	}

	const readme = snapshots.filter((s) => s.snapshot_type === 'readme');
	const source = snapshots.filter((s) => s.snapshot_type === 'source');
	const counted = snapshots.filter((s) => s.snapshot_type !== 'zip');
	return {
		readme_archived: readme.length > 0,
		source_archived: source.length > 0,
		metadata_only: false,
		total_snapshots: counted.length,
		total_bytes: counted.reduce((sum, snap) => sum + snap.file_size, 0),
		last_snapshot_at: counted[0]?.archived_at ?? null,
		readme_count: readme.length,
		source_count: source.length
	};
}

function formatBytesCompact(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString()} KB`;
	return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function daySpan(from: string, to: string): number {
	return Math.max(0, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));
}

function durationBetween(from: string, to: string): string {
	const minutes = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
	const days = Math.round(hours / 24);
	return `${days} day${days === 1 ? '' : 's'}`;
}

function evidenceIdsFor(references: EvidenceReference[], categories: EvidenceCategory[]): string[] {
	const allowed = new Set(categories);
	return references
		.filter((reference) => allowed.has(reference.category))
		.map((reference) => reference.id);
}

function evidenceMeta(
	references: EvidenceReference[],
	primary: EvidenceCategory,
	categories: EvidenceCategory[] = [primary]
): { evidenceIds: string[]; evidenceTarget: string } {
	return {
		evidenceIds: evidenceIdsFor(references, categories),
		evidenceTarget: evidenceGroupAnchor(primary)
	};
}

function historyCounts(repoId: number): { commits: number; licenses: number; topics: number } {
	const db = getDb();
	return {
		commits: (db.prepare('SELECT COUNT(*) as c FROM repo_commit_snapshots WHERE repo_id = ?').get(repoId) as { c: number }).c,
		licenses: (db.prepare('SELECT COUNT(*) as c FROM repo_license_history WHERE repo_id = ?').get(repoId) as { c: number }).c,
		topics: (db.prepare('SELECT COUNT(*) as c FROM repo_topics_history WHERE repo_id = ?').get(repoId) as { c: number }).c
	};
}

function currentStatus(repo: RepoSummary, localArchive: LocalArchiveSummary): string {
	if (localArchive.metadata_only) return 'Metadata-only mode';
	if (repo.deleted_at && localArchive.total_snapshots > 0) return 'Deleted but preserved';
	if (repo.deleted_at) return 'Deleted upstream';
	if (repo.github_archived && localArchive.total_snapshots > 0) return 'Archived on GitHub and preserved locally';
	if (repo.github_archived) return 'Archived on GitHub';
	if (repo.pushed_at && Date.now() - new Date(repo.pushed_at).getTime() < 90 * 86_400_000) return 'Active';
	if (repo.pushed_at && Date.now() - new Date(repo.pushed_at).getTime() > 365 * 86_400_000) return 'Stale';
	return 'Observed';
}

function buildEvidenceReferences(
	repo: RepoSummary,
	snapshots: ArchiveSnapshot[],
	releases: ReleaseWithAssets[],
	events: TimelineEvent[],
	metrics: MetricSnapshotRow[],
	technologies: TechnologyInsight[]
): EvidenceReference[] {
	const references: EvidenceReference[] = [];

	references.push({
		id: 'metadata-repository-record',
		category: 'derived',
		title: 'Metadata preserved',
		description: repo.is_enriched
			? 'Repository metadata, status, topics, license, and metrics are stored locally.'
			: 'Discovery metadata is stored locally; enrichment can add more repository facts.',
		confidence: 'direct',
		target: '#intelligence',
		timestamp: repo.enriched_at ?? repo.first_seen_at,
		artifactId: `repo:${repo.id}`
	});

	for (const snapshot of snapshots) {
		if (snapshot.snapshot_type === 'readme') {
			references.push({
				id: `snapshot-readme-${snapshot.id}`,
				category: 'readme',
				title: `README snapshot #${snapshot.id}`,
				description: `${formatBytesCompact(snapshot.file_size)} captured locally.`,
				confidence: 'direct',
				target: snapshot.download_url,
				timestamp: snapshot.archived_at,
				artifactId: `snapshot:${snapshot.id}`
			});
		} else {
			const isZip = snapshot.snapshot_type === 'zip';
			references.push({
				id: `snapshot-${snapshot.snapshot_type}-${snapshot.id}`,
				category: 'source',
				title: isZip ? `ZIP export snapshot #${snapshot.id}` : `Source snapshot #${snapshot.id}`,
				description: `${formatBytesCompact(snapshot.file_size)} ${isZip ? 'export' : 'source archive'} captured locally.`,
				confidence: 'direct',
				target: snapshot.download_url,
				timestamp: snapshot.archived_at,
				artifactId: `snapshot:${snapshot.id}`
			});
		}
	}

	for (const release of releases) {
		references.push({
			id: `release-${release.id}`,
			category: 'release',
			title: release.name || release.tag,
			description: `${release.assets.length.toLocaleString()} asset(s), tag ${release.tag}.`,
			confidence: 'direct',
			target: '#releases',
			timestamp: release.published_at ?? release.first_seen_at,
			artifactId: `release:${release.id}`
		});
	}

	for (const event of events) {
		references.push({
			id: `event-${event.id}`,
			category: 'timeline',
			title: event.label,
			description: event.event_type,
			confidence: 'direct',
			target: '#timeline',
			timestamp: event.event_time,
			artifactId: `event:${event.id}`
		});
	}

	for (const metric of metrics) {
		references.push({
			id: `metric-${metric.id}`,
			category: 'metric',
			title: 'Metric observation',
			description: `${metric.stars.toLocaleString()} stars, ${metric.forks.toLocaleString()} forks, ${metric.open_issues.toLocaleString()} open issue(s).`,
			confidence: 'direct',
			target: '#signal',
			timestamp: metric.captured_at,
			artifactId: `metric:${metric.id}`
		});
	}

	references.push(
		{
			id: 'derived-archive-score',
			category: 'derived',
			title: 'Archive Score',
			description: 'Deterministic score derived from preserved evidence, releases, events, and metrics.',
			confidence: 'derived',
			target: '#archive-score'
		},
		{
			id: 'derived-recoverability',
			category: 'derived',
			title: 'Recoverability',
			description: 'Deterministic recoverability estimate derived from preserved artifacts and history coverage.',
			confidence: 'derived',
			target: '#recoverability'
		},
		{
			id: 'derived-archive-story',
			category: 'derived',
			title: 'Archive Story',
			description: 'Narrative assembled from repository creation, discovery, snapshots, releases, and upstream status.',
			confidence: 'derived',
			target: '#archive-story'
		},
		{
			id: 'derived-current-status',
			category: 'derived',
			title: 'Current archive status',
			description: currentStatus(repo, buildLocalArchiveSummary(snapshots, repo.archive_storage_disabled)),
			confidence: 'derived',
			target: '#intelligence'
		}
	);

	if (technologies.length) {
		references.push({
			id: 'derived-technology-context',
			category: 'derived',
			title: 'Technology context',
			description: technologies.slice(0, 6).map((tech) => tech.name).join(', '),
			confidence: 'derived',
			target: '#intelligence'
		});
	}

	return references.sort((a, b) => {
		const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
		const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
		return bTime - aTime || a.title.localeCompare(b.title);
	});
}

function buildArchiveEvidence(
	latestReadme: ArchiveSnapshot | null,
	latestSource: ArchiveSnapshot | null,
	latestZip: ArchiveSnapshot | null,
	releases: ReleaseWithAssets[],
	snapshots: ArchiveSnapshot[],
	events: TimelineEvent[],
	repo: RepoSummary,
	evidenceReferences: EvidenceReference[],
	metadataOnly = false
): ArchiveEvidenceItem[] {
	const eventTimes = events.map((event) => event.event_time);
	const archiveTimes = snapshots.map((snapshot) => snapshot.archived_at);
	const allTimes = [...eventTimes, ...archiveTimes, repo.first_seen_at, repo.created_at].filter(Boolean).sort();
	const coverageDays = allTimes.length >= 2 ? daySpan(allTimes[0], allTimes.at(-1) ?? allTimes[0]) : 0;
	const releaseAssets = releases.reduce((sum, release) => sum + release.assets.length, 0);

	return [
		{
			label: 'Metadata',
			value: repo.is_enriched ? 'Preserved' : 'Discovered',
			detail: repo.is_enriched ? 'Repository metadata and metrics are stored locally' : 'Discovery record is stored locally',
			status: repo.is_enriched ? 'saved' : 'partial',
			...evidenceMeta(evidenceReferences, 'derived')
		},
		{
			label: 'README',
			value: metadataOnly ? 'Disabled' : latestReadme ? 'Captured' : 'Missing',
			detail: metadataOnly
				? 'README downloads are disabled by METADATA_ONLY=1'
				: latestReadme ? `${latestReadme.archived_at.slice(0, 10)} · ${formatBytesCompact(latestReadme.file_size)}` : 'No README snapshot saved yet',
			status: metadataOnly ? 'disabled' : latestReadme ? 'saved' : 'missing',
			...evidenceMeta(evidenceReferences, 'readme')
		},
		{
			label: 'Source',
			value: metadataOnly ? 'Disabled' : latestSource ? 'Captured' : 'Missing',
			detail: metadataOnly
				? 'Source tarball downloads are disabled by METADATA_ONLY=1'
				: latestSource ? `${latestSource.archived_at.slice(0, 10)} · ${formatBytesCompact(latestSource.file_size)}` : 'No source snapshot saved yet',
			status: metadataOnly ? 'disabled' : latestSource ? 'saved' : 'missing',
			...evidenceMeta(evidenceReferences, 'source')
		},
		{
			label: 'ZIP',
			value: metadataOnly ? 'Disabled' : latestZip || latestSource ? 'Available' : 'Not ready',
			detail: metadataOnly
				? 'ZIP export is disabled while source archive storage is off'
				: latestZip
				? `Export snapshot #${latestZip.id}`
				: latestSource
					? 'Generated from saved source when downloaded'
					: 'ZIP export will appear after source archival',
			status: metadataOnly ? 'disabled' : latestZip ? 'saved' : latestSource ? 'partial' : 'missing',
			...evidenceMeta(evidenceReferences, 'source')
		},
		{
			label: 'Releases',
			value: releases.length.toLocaleString(),
			detail: releaseAssets ? `${releaseAssets.toLocaleString()} release asset(s) indexed` : 'Release/tag records saved when available',
			status: releases.length ? 'saved' : 'partial',
			...evidenceMeta(evidenceReferences, 'release')
		},
		{
			label: 'Snapshots',
			value: snapshots.filter((snapshot) => snapshot.snapshot_type !== 'zip').length.toLocaleString(),
			detail: `${formatBytesCompact(snapshots.reduce((sum, snapshot) => sum + snapshot.file_size, 0))} stored locally`,
			status: snapshots.length ? 'saved' : 'missing',
			...evidenceMeta(evidenceReferences, 'source', ['readme', 'source'])
		},
		{
			label: 'History Coverage',
			value: `${coverageDays.toLocaleString()} day${coverageDays === 1 ? '' : 's'}`,
			detail: `${events.length.toLocaleString()} event(s) reconstructed`,
			status: events.length >= 5 ? 'saved' : events.length ? 'partial' : 'missing',
			...evidenceMeta(evidenceReferences, 'timeline')
		}
	];
}

function buildArchiveScore(
	repo: RepoSummary,
	localArchive: LocalArchiveSummary,
	releases: ReleaseWithAssets[],
	events: TimelineEvent[],
	metrics: MetricSnapshotRow[],
	history: { commits: number; licenses: number; topics: number },
	technologies: TechnologyInsight[],
	evidenceReferences: EvidenceReference[],
	metadataOnly = false
): ArchiveScore {
	const hasSource = localArchive.source_archived;
	const hasReadme = localArchive.readme_archived;
	const hasReleases = releases.length > 0;
	const hasCommitHistory = history.commits > 0;
	const timelineDepth = events.length + localArchive.total_snapshots + releases.length;
	const hasFeatureExtraction = technologies.some((tech) => tech.source === 'source');
	const hasDependencyExtraction = false;
	const activeDevelopment = repo.pushed_at
		? Date.now() - new Date(repo.pushed_at).getTime() < 180 * 86_400_000
		: false;
	const deletedButPreserved = Boolean(repo.deleted_at && localArchive.total_snapshots > 0);

	const factors: ArchiveScoreFactor[] = [
		{ label: 'README archived', weight: 10, earned: hasReadme ? 10 : 0, detail: metadataOnly ? 'README archive disabled in metadata-only mode' : hasReadme ? `${localArchive.readme_count} README snapshot(s)` : 'No README snapshot yet', ...evidenceMeta(evidenceReferences, 'readme') },
		{ label: 'Source archived', weight: 25, earned: hasSource ? 25 : 0, detail: metadataOnly ? 'Source archive disabled in metadata-only mode' : hasSource ? `${localArchive.source_count} source snapshot(s)` : 'No source snapshot yet', ...evidenceMeta(evidenceReferences, 'source') },
		{ label: 'Releases archived', weight: 10, earned: hasReleases ? 10 : 0, detail: hasReleases ? `${releases.length} release/tag record(s)` : 'No release records yet', ...evidenceMeta(evidenceReferences, 'release') },
		{ label: 'Commit history observed', weight: 10, earned: hasCommitHistory ? 10 : 0, detail: hasCommitHistory ? `${history.commits} commit observation(s)` : 'No commit history observations yet', ...evidenceMeta(evidenceReferences, 'timeline') },
		{ label: 'Timeline depth', weight: 10, earned: timelineDepth >= 8 ? 10 : timelineDepth >= 3 ? 5 : 0, detail: `${timelineDepth} timeline evidence point(s)`, ...evidenceMeta(evidenceReferences, 'timeline', ['timeline', 'readme', 'source', 'release']) },
		{ label: 'Feature extraction', weight: 10, earned: hasFeatureExtraction ? 10 : 0, detail: metadataOnly ? 'Source feature extraction disabled in metadata-only mode' : hasFeatureExtraction ? 'Source-derived features detected' : 'Persistent feature scan not available yet', ...evidenceMeta(evidenceReferences, 'source', ['source', 'derived']) },
		{ label: 'Dependency extraction', weight: 10, earned: hasDependencyExtraction ? 10 : 0, detail: 'Dependency scan is planned for v13', ...evidenceMeta(evidenceReferences, 'derived') },
		{ label: 'Active development', weight: 10, earned: activeDevelopment ? 10 : metrics.length >= 2 ? 5 : 0, detail: activeDevelopment ? 'Recent push activity observed' : 'No recent push activity observed', ...evidenceMeta(evidenceReferences, 'metric', ['metric', 'timeline']) },
		{ label: 'Deleted but preserved', weight: 5, earned: deletedButPreserved ? 5 : 0, detail: deletedButPreserved ? 'Upstream deleted; local archive remains' : 'Repo still exists upstream or no local archive yet', ...evidenceMeta(evidenceReferences, 'timeline', ['timeline', 'readme', 'source']) }
	];
	const score = factors.reduce((sum, factor) => sum + factor.earned, 0);
	const reasons = factors.filter((factor) => factor.earned > 0).map((factor) => factor.detail);
	const warnings = factors.filter((factor) => factor.earned === 0).map((factor) => factor.detail);
	const label = score >= 90 ? 'Excellent archive' : score >= 75 ? 'Strong archive' : score >= 55 ? 'Partial archive' : score >= 30 ? 'Thin archive' : 'Needs preservation';

	return { score, label, reasons, warnings, factors };
}

function buildRecoverability(
	repo: RepoSummary,
	localArchive: LocalArchiveSummary,
	releases: ReleaseWithAssets[],
	events: TimelineEvent[],
	history: { commits: number; licenses: number; topics: number },
	evidenceReferences: EvidenceReference[],
	metadataOnly = false
): RecoverabilityReport {
	const metadataScore = repo.is_enriched ? 100 : 35;
	const timelineScore = Math.min(100, Math.round((events.length / 12) * 100));
	const commitScore = Math.min(100, history.commits * 25);
	const historyScore = Math.min(100, history.licenses * 35 + history.topics * 35 + commitScore * 0.3);
	const items: RecoverabilityItem[] = [
		{ label: 'README', score: localArchive.readme_archived ? 100 : 0, detail: metadataOnly ? 'README archive disabled' : localArchive.readme_archived ? `${localArchive.readme_count} README snapshot(s)` : 'No README snapshot', ...evidenceMeta(evidenceReferences, 'readme') },
		{ label: 'Source', score: localArchive.source_archived ? 100 : 0, detail: metadataOnly ? 'Source archive disabled' : localArchive.source_archived ? `${localArchive.source_count} source snapshot(s)` : 'No source snapshot', ...evidenceMeta(evidenceReferences, 'source') },
		{ label: 'Releases', score: releases.length ? 100 : 20, detail: releases.length ? `${releases.length} release/tag record(s)` : 'No release records found', ...evidenceMeta(evidenceReferences, 'release') },
		{ label: 'Metadata', score: metadataScore, detail: repo.is_enriched ? 'GitHub metadata enriched' : 'Only discovery metadata available', ...evidenceMeta(evidenceReferences, 'derived') },
		{ label: 'History', score: Math.round(Math.max(timelineScore, historyScore)), detail: `${events.length} event(s), ${history.commits} commit observation(s)`, ...evidenceMeta(evidenceReferences, 'timeline') },
		{ label: 'Dependencies', score: 0, detail: 'Dependency extraction is not implemented yet', ...evidenceMeta(evidenceReferences, 'derived') }
	];
	const weighted =
		items[0].score * 0.2 +
		items[1].score * 0.3 +
		items[2].score * 0.1 +
		items[3].score * 0.1 +
		items[4].score * 0.25 +
		items[5].score * 0.05;
	return { overall: metadataOnly ? Math.min(55, Math.round(weighted)) : Math.round(weighted), items };
}

function buildArchiveStory(
	repo: RepoSummary,
	events: TimelineEvent[],
	snapshots: ArchiveSnapshot[],
	releases: ReleaseWithAssets[],
	localArchive: LocalArchiveSummary
): string[] {
	const story: string[] = [
		`Created on ${repo.created_at.slice(0, 10)}.`,
		`First discovered by GithubArchive+ on ${repo.first_seen_at.slice(0, 10)} via ${repo.discovery_source}.`
	];
	if (localArchive.metadata_only) {
		story.push('Metadata-only mode is enabled, so repository facts, metrics, events, and intelligence are preserved without downloading README or source artifacts.');
	}
	const firstSnapshot = [...snapshots].sort((a, b) => a.archived_at.localeCompare(b.archived_at))[0];
	if (firstSnapshot) {
		story.push(`First archived ${durationBetween(repo.first_seen_at, firstSnapshot.archived_at)} after discovery.`);
	}
	const readmeChanges = events.filter((event) => event.event_type === 'readme_changed');
	if (readmeChanges.length > 1) {
		story.push(`README changed ${readmeChanges.length} times, suggesting the project documentation evolved after discovery.`);
	} else if (readmeChanges.length === 1) {
		story.push('README changed after the first archive snapshot.');
	}
	if (localArchive.source_archived) {
		story.push(`Source was preserved locally in ${localArchive.source_count} snapshot${localArchive.source_count === 1 ? '' : 's'}.`);
	}
	if (releases.length) {
		story.push(`Release history is represented by ${releases.length} release/tag record${releases.length === 1 ? '' : 's'}.`);
	}
	if (repo.github_archived) story.push('GitHub marks this repository as archived.');
	if (repo.deleted_at && localArchive.total_snapshots > 0) {
		story.push(`The repository was deleted upstream, but GithubArchive+ preserved local evidence before or during disappearance.`);
	} else if (repo.deleted_at) {
		story.push('The repository was deleted upstream before a complete local archive was available.');
	}
	return story;
}

function firstSnapshotOfType(
	snapshots: ArchiveSnapshot[],
	type: 'readme' | 'source' | 'zip'
): ArchiveSnapshot | null {
	return [...snapshots]
		.filter((snapshot) => snapshot.snapshot_type === type)
		.sort((a, b) => a.archived_at.localeCompare(b.archived_at))[0] ?? null;
}

function buildArchiveStoryTimeline(
	repo: RepoSummary,
	snapshots: ArchiveSnapshot[],
	releases: ReleaseWithAssets[],
	localArchive: LocalArchiveSummary,
	evidenceReferences: EvidenceReference[]
): ArchiveStoryStep[] {
	const steps: ArchiveStoryStep[] = [
		{
			label: 'Created',
			date: repo.created_at,
			detail: 'Repository created on GitHub.',
			tone: 'neutral',
			...evidenceMeta(evidenceReferences, 'timeline')
		},
		{
			label: 'First discovered',
			date: repo.first_seen_at,
			detail: `GithubArchive+ discovered it via ${repo.discovery_source}.`,
			tone: 'neutral',
			...evidenceMeta(evidenceReferences, 'timeline')
		}
	];
	const firstReadme = firstSnapshotOfType(snapshots, 'readme');
	const firstSource = firstSnapshotOfType(snapshots, 'source');
	const firstRelease = [...releases]
		.sort((a, b) => (a.published_at ?? a.first_seen_at).localeCompare(b.published_at ?? b.first_seen_at))[0] ?? null;

	if (firstReadme) {
		steps.push({
			label: 'README archived',
			date: firstReadme.archived_at,
			detail: `${formatBytesCompact(firstReadme.file_size)} README evidence saved locally.`,
			tone: 'saved',
			...evidenceMeta(evidenceReferences, 'readme')
		});
	}
	if (firstSource) {
		steps.push({
			label: 'Source preserved',
			date: firstSource.archived_at,
			detail: `${formatBytesCompact(firstSource.file_size)} source snapshot saved locally.`,
			tone: 'saved',
			...evidenceMeta(evidenceReferences, 'source')
		});
	}
	if (firstRelease) {
		steps.push({
			label: 'Release detected',
			date: firstRelease.published_at ?? firstRelease.first_seen_at,
			detail: `${firstRelease.name || firstRelease.tag} recorded in release history.`,
			tone: 'neutral',
			...evidenceMeta(evidenceReferences, 'release')
		});
	}
	if (repo.github_archived) {
		steps.push({
			label: 'Archived upstream',
			date: repo.last_checked_at ?? repo.enriched_at ?? repo.first_seen_at,
			detail: 'GitHub marks this repository as archived.',
			tone: localArchive.total_snapshots > 0 ? 'saved' : 'warning',
			...evidenceMeta(evidenceReferences, 'timeline')
		});
	}
	if (repo.deleted_at) {
		steps.push({
			label: localArchive.total_snapshots > 0 ? 'Deleted but saved' : 'Deleted upstream',
			date: repo.deleted_at,
			detail:
				localArchive.total_snapshots > 0
					? 'The upstream repository disappeared, but local archive evidence remains.'
					: 'The upstream repository disappeared before local preservation was complete.',
			tone: localArchive.total_snapshots > 0 ? 'saved' : 'warning',
			...evidenceMeta(evidenceReferences, 'timeline', ['timeline', 'readme', 'source'])
		});
	}

	return steps.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function buildArchiveStoryTakeaway(
	repo: RepoSummary,
	localArchive: LocalArchiveSummary,
	releases: ReleaseWithAssets[]
): string[] {
	if (localArchive.metadata_only) {
		return [
			'This repository is being tracked in metadata-only mode.',
			'GitHubArchive+ preserves its repository facts, metrics, events, and intelligence while heavy README/source storage is disabled.'
		];
	}

	const savedKinds = [
		localArchive.readme_archived ? 'README' : null,
		localArchive.source_archived ? 'source' : null,
		releases.length ? 'release history' : null
	].filter(Boolean);

	if (repo.deleted_at && localArchive.total_snapshots > 0) {
		return [
			`This repository was preserved before upstream loss, with ${savedKinds.length ? savedKinds.join(', ') : 'archive'} evidence still available locally.`,
			'GithubArchive+ can still show its preserved record even though the GitHub source is gone.'
		];
	}
	if (repo.github_archived && localArchive.total_snapshots > 0) {
		return [
			`GitHub marks this repository as archived, but GithubArchive+ has preserved ${savedKinds.length ? savedKinds.join(', ') : 'local'} evidence.`,
			'The archive keeps the project inspectable after upstream activity has stopped.'
		];
	}
	if (localArchive.readme_archived && localArchive.source_archived) {
		return [
			'This repository has both README and source evidence saved locally.',
			'Its preserved snapshots make the project recoverable beyond GitHub metadata.'
		];
	}
	if (localArchive.total_snapshots > 0) {
		return [
			'This repository has partial local preservation.',
			'Additional source, release, and dependency evidence would make the archive more complete.'
		];
	}
	return [
		'This repository is known to GithubArchive+ but still needs preservation work.',
		'Archiving README and source snapshots would make its history recoverable.'
	];
}

function buildRepositoryIntelligenceReport(
	repo: RepoSummary,
	summary: ProfileSummary,
	localArchive: LocalArchiveSummary,
	snapshots: ArchiveSnapshot[],
	latestReadme: ArchiveSnapshot | null,
	latestSource: ArchiveSnapshot | null,
	latestZip: ArchiveSnapshot | null,
	releases: ReleaseWithAssets[],
	events: TimelineEvent[],
	metrics: MetricSnapshotRow[],
	technologies: TechnologyInsight[]
): RepositoryIntelligenceReport {
	const history = historyCounts(repo.id);
	const status = currentStatus(repo, localArchive);
	const evidenceReferences = buildEvidenceReferences(repo, snapshots, releases, events, metrics, technologies);
	const evidenceGroups = groupEvidenceReferences(evidenceReferences);
	const evidence = buildArchiveEvidence(
		latestReadme,
		latestSource,
		latestZip,
		releases,
		snapshots,
		events,
		repo,
		evidenceReferences,
		localArchive.metadata_only
	);
	const archiveScore = buildArchiveScore(repo, localArchive, releases, events, metrics, history, technologies, evidenceReferences, localArchive.metadata_only);
	const recoverability = buildRecoverability(repo, localArchive, releases, events, history, evidenceReferences, localArchive.metadata_only);
	const storyTimeline = buildArchiveStoryTimeline(repo, snapshots, releases, localArchive, evidenceReferences);
	const storyTakeaway = buildArchiveStoryTakeaway(repo, localArchive, releases);
	const technologyNames = technologies.slice(0, 5).map((tech) => tech.name);
	const whyArchive =
		localArchive.metadata_only
			? 'This repository is tracked safely in metadata-only mode. Full recoverability is limited until README and source archive storage are enabled.'
			: archiveScore.score >= 75
			? 'This repository has enough preserved evidence to be useful as a historical software record.'
			: localArchive.total_snapshots > 0
				? 'This repository has partial local evidence and should be archived further to improve recoverability.'
				: 'This repository is known to the archive but still needs preservation work.';

	return {
		identity: summary.definition,
		purpose: summary.use_case.replace(/^Use-case:\s*/, ''),
		whyArchive,
		currentStatus: status,
		evidence,
		archiveScore,
		recoverability,
		storyTimeline,
		storyTakeaway,
		evidenceReferences,
		evidenceGroups,
		story: buildArchiveStory(repo, events, snapshots, releases, localArchive).concat(
			technologyNames.length ? [`Detected technology context includes ${technologyNames.join(', ')}.`] : []
		)
	};
}

function buildMergedTimeline(
	events: TimelineEvent[],
	snapshots: ArchiveSnapshot[],
	releases: ReleaseWithAssets[],
	metrics: MetricSnapshotRow[],
	repo: RepoSummary
): MergedTimelineItem[] {
	const items: MergedTimelineItem[] = [
		{ type: 'created', label: 'Repository created', time: repo.created_at, detail: repo.github_url },
		{ type: 'first_seen', label: 'First seen by archive', time: repo.first_seen_at, detail: repo.discovery_source }
	];
	for (const event of events) items.push({ type: event.event_type, label: event.label, time: event.event_time, detail: null });
	for (const snapshot of snapshots) {
		if (snapshot.snapshot_type === 'zip') continue;
		items.push({
			type: `${snapshot.snapshot_type}_archived`,
			label:
				snapshot.snapshot_type === 'readme'
					? 'README archived'
					: snapshot.snapshot_type === 'zip'
						? 'Source ZIP archived'
						: 'Source archived',
			time: snapshot.archived_at,
			detail: `${snapshot.snapshot_type} ${snapshot.id}`
		});
	}
	for (const release of releases) {
		items.push({
			type: 'release',
			label: release.name || release.tag,
			time: release.published_at ?? release.first_seen_at,
			detail: release.tag
		});
	}
	for (const metric of metrics.slice(0, 8)) {
		items.push({
			type: 'metrics',
			label: 'Metric update',
			time: metric.captured_at,
			detail: `${metric.stars} stars, ${metric.forks} forks`
		});
	}
	if (repo.enriched_at) items.push({ type: 'enriched', label: 'Metadata enriched', time: repo.enriched_at, detail: null });
	if (repo.deleted_at) items.push({ type: 'deleted', label: 'Repository marked deleted', time: repo.deleted_at, detail: null });
	return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 40);
}

function relatedProjects(repo: RepoSummary): RepoSummary[] {
	const topicQuery = repo.topics.slice(0, 3).join(' ');
	const result = queryRepos({
		q: topicQuery || undefined,
		language: topicQuery ? undefined : (repo.language ?? undefined),
		perPage: 40,
		page: 1
	});
	const sourceTopics = new Set(repo.topics);
	return result.repos
		.filter((row) => row.id !== repo.id)
		.map(toSummary)
		.map((candidate) => {
			const sharedTopics = candidate.topics.filter((topic) => sourceTopics.has(topic)).length;
			const language = repo.language && candidate.language === repo.language ? 2 : 0;
			const owner = candidate.owner === repo.owner ? 1 : 0;
			return { candidate, score: sharedTopics * 4 + language + owner + (candidate.stars ?? 0) / 100000 };
		})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 5)
		.map((item) => item.candidate);
}

function buildTruthNotices(
	repo: RepoSummary,
	latestSource: ArchiveSnapshot | null,
	localArchive: LocalArchiveSummary
): SourceTruthNotice[] {
	const notices: SourceTruthNotice[] = [];
	if (repo.deleted_at && localArchive.total_snapshots > 0) {
		notices.push({
			type: 'deleted_with_archive',
			message: 'GitHub metadata says this repo is deleted; local archive history is still shown from snapshots.'
		});
	}
	if (repo.github_archived && localArchive.total_snapshots > 0) {
		notices.push({
			type: 'archived_with_snapshots',
			message: 'GitHub marks this repo archived; README/source/history come from local archive snapshots.'
		});
	}
	if (repo.pushed_at && latestSource?.archived_at && new Date(repo.pushed_at) > new Date(latestSource.archived_at)) {
		notices.push({
			type: 'stale_archive',
			message: 'GitHub metadata is newer than the latest source snapshot, so source/archive views may be stale.'
		});
	}
	return notices;
}

function mapReleasesWithAssets(releases: ReleaseRow[], assets: ReleaseAssetRow[]): ReleaseWithAssets[] {
	const assetsByRelease = new Map<number, ReleaseAssetRow[]>();
	for (const asset of assets) {
		const list = assetsByRelease.get(asset.release_id) ?? [];
		list.push(asset);
		assetsByRelease.set(asset.release_id, list);
	}
	return releases.map((release) => ({
		...release,
		assets: assetsByRelease.get(release.id) ?? [],
		body_html: release.body ? renderMarkdownSafe(release.body) : null
	}));
}

export function getRepoWithSnapshots(owner: string, name: string) {
	const row = getRepoBySlug(owner, name);
	if (!row) return null;

	const repo = toSummary(row);
	const metadataOnly = isMetadataOnlyMode();
	const storedSnapshots = listArchiveSnapshots(row.id).map(toArchiveSnapshot);
	const snapshots = metadataOnly ? [] : storedSnapshots;
	const readmeSnapshots = snapshots.filter((s) => s.snapshot_type === 'readme');
	const sourceSnapshots = snapshots.filter((s) => s.snapshot_type === 'source');
	const zipSnapshots = snapshots.filter((s) => s.snapshot_type === 'zip');
	const latestReadme = readmeSnapshots[0] ?? null;
	const latestSource = sourceSnapshots[0] ?? null;
	const latestZip = zipSnapshots[0] ?? null;

	let readmeHtml: string | null = null;
	let readmeText = '';
	if (latestReadme?.file_exists) {
		const snapRow = getArchiveSnapshotById(latestReadme.id);
		if (snapRow) {
			const text = readSnapshotText(snapRow);
			if (text) {
				readmeText = text;
				readmeHtml = enhanceReadmeHtml(renderMarkdownSafe(rewriteReadmeUrls(text, repo)));
			}
		}
	}

	const sourceAnalysis: SourceAnalysis | null = null;
	const releaseRows = listRepoReleases(row.id);
	const releases = mapReleasesWithAssets(releaseRows, listRepoReleaseAssets(row.id));
	const metrics = listMetricSnapshots(row.id, 60);
	const events = listRepoEvents(row.id, 80).map((e) => toTimelineEvent(e));
	const readmeImages = extractReadmeImages(readmeText, repo);
	const links = extractLinks(readmeText, repo);
	const readmeFeatures = readmeFeatureFlags(readmeText);
	const technologies = buildTechnologyInsights(repo, readmeText, sourceAnalysis);
	const activity = buildActivitySummary(repo, metrics);
	const localArchive = buildLocalArchiveSummary(snapshots, metadataOnly);
	const projectSignal = buildProjectSignal(repo, readmeText, snapshots, releases, metrics);
	const summary = buildProfileSummary(repo, readmeText, releases, technologies);
	const mergedTimeline = buildMergedTimeline(events, snapshots, releases, metrics, repo);
	const truthNotices = buildTruthNotices(repo, latestSource, localArchive);
	const intelligenceReport = buildRepositoryIntelligenceReport(
		repo,
		summary,
		localArchive,
		snapshots,
		latestReadme,
		latestSource,
		latestZip,
		releases,
		events,
		metrics,
		technologies
	);

	return {
		repo,
		metadataOnly,
		downloadZipUrl: getRepoZipDownloadUrl(repo.owner, repo.name, row.id),
		snapshots,
		readmeSnapshots,
		sourceSnapshots,
		zipSnapshots,
		latestReadme,
		latestSource,
		latestZip,
		readmeHtml,
		readmeImages,
		readmeFeatures,
		sourceAnalysis,
		releases,
		latestRelease: releases[0] ?? null,
		activity,
		technologies,
		securityFiles: sourceAnalysis?.security_files ?? [],
		links,
		projectSignal,
		health: {
			score: projectSignal.score,
			label: projectSignal.label,
			factors: Object.entries(projectSignal.breakdown).map(([label, value]) => ({
				label,
				value,
				detail: projectSignal.explanation
			}))
		},
		summary,
		intelligenceReport,
		related: relatedProjects(repo),
		mergedTimeline,
		localArchive,
		truthNotices
	};
}
