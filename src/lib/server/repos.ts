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
import { renderMarkdownSafe } from '$lib/server/markdown';
import { enrichSnapshotMeta, readSnapshotText } from '$lib/server/snapshots';
import type { SourceAnalysis } from '$lib/server/source-archive';
import { getRepoZipDownloadUrl } from '$lib/server/source-zip';
import { momentTag, velocityIndicator } from '$lib/server/intelligence';
import {
	eventLabel,
	listRepoEvents,
	parseEventPayload,
	type RepoEventRow,
	type RepoEventType
} from '$lib/server/events';

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
}

function toSummary(row: RepoRow & { fts_snippet?: string | null; fts_rank?: number | null }): RepoSummary {
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
		download_zip_url: getRepoZipDownloadUrl(row.owner, row.name, row.id)
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
	total_snapshots: number;
	total_bytes: number;
	last_snapshot_at: string | null;
	readme_count: number;
	source_count: number;
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

function buildLocalArchiveSummary(snapshots: ArchiveSnapshot[]): LocalArchiveSummary {
	const readme = snapshots.filter((s) => s.snapshot_type === 'readme');
	const source = snapshots.filter((s) => s.snapshot_type === 'source');
	const counted = snapshots.filter((s) => s.snapshot_type !== 'zip');
	return {
		readme_archived: readme.length > 0,
		source_archived: source.length > 0,
		total_snapshots: counted.length,
		total_bytes: counted.reduce((sum, snap) => sum + snap.file_size, 0),
		last_snapshot_at: counted[0]?.archived_at ?? null,
		readme_count: readme.length,
		source_count: source.length
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
	const snapshots = listArchiveSnapshots(row.id).map(toArchiveSnapshot);
	const readmeSnapshots = snapshots.filter((s) => s.snapshot_type === 'readme');
	const sourceSnapshots = snapshots.filter((s) => s.snapshot_type === 'source');
	const latestReadme = readmeSnapshots[0] ?? null;
	const latestSource = sourceSnapshots[0] ?? null;

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
	const localArchive = buildLocalArchiveSummary(snapshots);
	const projectSignal = buildProjectSignal(repo, readmeText, snapshots, releases, metrics);
	const summary = buildProfileSummary(repo, readmeText, releases, technologies);
	const mergedTimeline = buildMergedTimeline(events, snapshots, releases, metrics, repo);
	const truthNotices = buildTruthNotices(repo, latestSource, localArchive);

	return {
		repo,
		downloadZipUrl: getRepoZipDownloadUrl(repo.owner, repo.name, row.id),
		snapshots,
		readmeSnapshots,
		sourceSnapshots,
		latestReadme,
		latestSource,
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
		related: relatedProjects(repo),
		mergedTimeline,
		localArchive,
		truthNotices
	};
}
