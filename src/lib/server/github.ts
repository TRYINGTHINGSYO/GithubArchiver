const GITHUB_API = 'https://api.github.com';

function headers(): HeadersInit {
	const h: HeadersInit = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'GithubArchivePlus/0.3',
		'X-GitHub-Api-Version': '2022-11-28'
	};
	const token = process.env.GITHUB_TOKEN;
	if (token) h.Authorization = `Bearer ${token}`;
	return h;
}

export interface GitHubRepo {
	name: string;
	full_name: string;
	owner: { login: string; avatar_url: string | null; type: string | null };
	description: string | null;
	homepage: string | null;
	default_branch: string;
	stargazers_count: number;
	forks_count: number;
	watchers_count: number;
	open_issues_count: number;
	size: number;
	language: string | null;
	topics?: string[];
	created_at: string;
	pushed_at: string | null;
	updated_at: string;
	license: { spdx_id: string | null } | null;
	archived: boolean;
	visibility?: string;
}

export interface GitHubRelease {
	id: number;
	tag_name: string;
	name: string | null;
	published_at: string | null;
	prerelease: boolean;
	draft: boolean;
	body: string | null;
	tarball_url: string | null;
	zipball_url: string | null;
	assets: {
		id: number;
		name: string;
		size: number;
		download_count: number;
		content_type: string;
		browser_download_url: string;
	}[];
}

export interface GitHubTag {
	name: string;
	commit: { sha: string; url: string };
}

export class GitHubNotFoundError extends Error {
	constructor(
		public owner: string,
		public repo: string
	) {
		super(`Repository ${owner}/${repo} not found`);
		this.name = 'GitHubNotFoundError';
	}
}

export class GitHubRateLimitError extends Error {
	constructor(
		public resetAt: Date,
		public secondary = false,
		public retryAfterSeconds: number | null = null
	) {
		super(
			secondary
				? `GitHub secondary rate limit; retry after ${retryAfterSeconds ?? 60}s`
				: `GitHub rate limit exceeded until ${resetAt.toISOString()}`
		);
		this.name = 'GitHubRateLimitError';
	}
}

/** True when a token is configured. Never returns or logs the token value. */
export function hasGitHubToken(): boolean {
	return Boolean(process.env.GITHUB_TOKEN?.trim());
}

function sanitizeGitHubErrorBody(body: string): string {
	// Never echo credentials if a misconfigured proxy or error page included them.
	return body
		.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
		.replace(/github_pat_[A-Za-z0-9_]+/gi, '[redacted]')
		.replace(/ghp_[A-Za-z0-9_]+/gi, '[redacted]')
		.slice(0, 500);
}

function rateLimitErrorFromResponse(res: Response): never {
	const remaining = res.headers.get('x-ratelimit-remaining');
	const reset = res.headers.get('x-ratelimit-reset');
	const retryAfter = res.headers.get('retry-after');
	const retryAfterSeconds = retryAfter ? Number(retryAfter) : null;
	// Secondary limits often return 403/429 while the primary quota still has remaining.
	const secondary =
		res.status === 429 ||
		(remaining != null && remaining !== '0') ||
		Boolean(retryAfter && remaining !== '0');
	const resetAt = reset
		? new Date(Number(reset) * 1000)
		: new Date(Date.now() + (retryAfterSeconds && Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 60_000));
	throw new GitHubRateLimitError(resetAt, secondary, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null);
}

export class DownloadTooLargeError extends Error {
	constructor(
		public size: number,
		public maxBytes: number
	) {
		super(`Download size ${size} exceeds limit ${maxBytes}`);
		this.name = 'DownloadTooLargeError';
	}
}

export class DownloadTimeoutError extends Error {
	constructor(public timeoutMs: number) {
		super(`Download timed out after ${timeoutMs}ms`);
		this.name = 'DownloadTimeoutError';
	}
}

async function ghFetch<T>(path: string): Promise<T> {
	const res = await fetch(`${GITHUB_API}${path}`, { headers: headers() });

	if (res.status === 404) {
		const parts = path.replace('/repos/', '').split('/');
		throw new GitHubNotFoundError(parts[0], parts[1]);
	}

	if (res.status === 403 || res.status === 429) {
		rateLimitErrorFromResponse(res);
	}

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`GitHub API ${res.status}: ${sanitizeGitHubErrorBody(body)}`);
	}

	return res.json() as Promise<T>;
}

export async function fetchRepoMetadata(owner: string, repo: string) {
	const gh = await ghFetch<GitHubRepo>(`/repos/${owner}/${repo}`);
	return {
		owner: gh.owner.login,
		name: gh.name,
		full_name: gh.full_name,
		default_branch: gh.default_branch,
		description: gh.description,
		homepage: gh.homepage || null,
		visibility: gh.visibility ?? 'public',
		owner_avatar_url: gh.owner.avatar_url,
		owner_type: gh.owner.type,
		language: gh.language,
		stars: gh.stargazers_count,
		forks: gh.forks_count,
		watchers: gh.watchers_count,
		open_issues: gh.open_issues_count,
		size: gh.size,
		license: gh.license?.spdx_id ?? null,
		topics: gh.topics ?? [],
		created_at: gh.created_at,
		pushed_at: gh.pushed_at,
		updated_at: gh.updated_at,
		archived: gh.archived
	};
}

export async function fetchReleases(owner: string, repo: string): Promise<GitHubRelease[]> {
	try {
		return await ghFetch<GitHubRelease[]>(`/repos/${owner}/${repo}/releases?per_page=30`);
	} catch (err) {
		if (err instanceof GitHubNotFoundError) throw err;
		return [];
	}
}

export async function fetchTags(owner: string, repo: string): Promise<GitHubTag[]> {
	try {
		return await ghFetch<GitHubTag[]>(`/repos/${owner}/${repo}/tags?per_page=30`);
	} catch (err) {
		if (err instanceof GitHubNotFoundError) throw err;
		return [];
	}
}

export async function fetchReadme(owner: string, repo: string): Promise<string | null> {
	const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/readme`, {
		headers: { ...headers(), Accept: 'application/vnd.github.raw' }
	});
	if (res.status === 404) return null;
	if (!res.ok) return null;
	return res.text();
}

interface GitHubCommitRef {
	sha: string;
}

interface GitHubCommitDetail {
	sha: string;
	commit: {
		author: { name: string; email: string; date: string };
		tree: { sha: string };
	};
	parents: { sha: string }[];
}

export interface BranchCommitInfo {
	sha: string;
	tree_sha: string;
	parent_sha: string | null;
	committed_at: string;
	author_name: string;
	author_email: string;
}

export async function fetchBranchHeadSha(
	owner: string,
	repo: string,
	branch: string
): Promise<string> {
	const commit = await ghFetch<GitHubCommitRef>(
		`/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`
	);
	return commit.sha;
}

export async function fetchBranchCommit(
	owner: string,
	repo: string,
	branch: string
): Promise<BranchCommitInfo> {
	const data = await ghFetch<GitHubCommitDetail>(
		`/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`
	);
	return {
		sha: data.sha,
		tree_sha: data.commit.tree.sha,
		parent_sha: data.parents[0]?.sha ?? null,
		committed_at: data.commit.author.date,
		author_name: data.commit.author.name,
		author_email: data.commit.author.email
	};
}

export async function downloadSourceTarball(
	owner: string,
	repo: string,
	ref: string,
	opts: { maxBytes: number; timeoutMs: number }
): Promise<Buffer> {
	const url = `${GITHUB_API}/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

	try {
		const res = await fetch(url, {
			headers: headers(),
			signal: controller.signal,
			redirect: 'follow'
		});

		if (res.status === 404) {
			throw new GitHubNotFoundError(owner, repo);
		}
		if (!res.ok) {
			const body = await res.text();
			throw new Error(`Tarball download failed ${res.status}: ${body}`);
		}

		const contentLength = res.headers.get('content-length');
		if (contentLength && Number(contentLength) > opts.maxBytes) {
			throw new DownloadTooLargeError(Number(contentLength), opts.maxBytes);
		}

		const body = res.body;
		if (!body) throw new Error('No response body');

		const reader = body.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.length;
			if (total > opts.maxBytes) {
				throw new DownloadTooLargeError(total, opts.maxBytes);
			}
			chunks.push(value);
		}

		return Buffer.concat(chunks);
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			throw new DownloadTimeoutError(opts.timeoutMs);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

export interface GitHubSearchRepoItem {
	id: number;
	name: string;
	full_name: string;
	owner: { login: string };
	html_url: string;
	created_at: string;
	description?: string | null;
	stargazers_count?: number;
	language?: string | null;
}

export interface GitHubSearchRepoResponse {
	total_count: number;
	incomplete_results: boolean;
	items: GitHubSearchRepoItem[];
}

export type GitHubSearchSort = 'created' | 'stars' | 'updated';

export async function searchRepositories(
	query: string,
	page: number,
	perPage = 100,
	opts: { sort?: GitHubSearchSort; order?: 'asc' | 'desc' } = {}
): Promise<GitHubSearchRepoResponse> {
	const params = new URLSearchParams({
		q: query,
		sort: opts.sort ?? 'created',
		order: opts.order ?? (opts.sort === 'stars' || opts.sort === 'updated' ? 'desc' : 'asc'),
		per_page: String(perPage),
		page: String(page)
	});
	const res = await fetch(`${GITHUB_API}/search/repositories?${params}`, { headers: headers() });

	if (res.status === 403 || res.status === 429) {
		rateLimitErrorFromResponse(res);
	}
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`GitHub Search API ${res.status}: ${sanitizeGitHubErrorBody(body)}`);
	}

	return res.json() as Promise<GitHubSearchRepoResponse>;
}

export interface GitHubRateLimitInfo {
	limit: number;
	remaining: number;
	used: number;
	resetAt: string | null;
	searchLimit: number;
	searchRemaining: number;
	searchResetAt: string | null;
}

export async function fetchGitHubRateLimit(): Promise<GitHubRateLimitInfo> {
	const res = await fetch(`${GITHUB_API}/rate_limit`, { headers: headers() });
	if (!res.ok) {
		return {
			limit: 0,
			remaining: 0,
			used: 0,
			resetAt: null,
			searchLimit: 0,
			searchRemaining: 0,
			searchResetAt: null
		};
	}
	const body = (await res.json()) as {
		rate: { limit: number; remaining: number; used: number; reset: number };
		resources?: {
			search?: { limit: number; remaining: number; reset: number };
		};
	};
	const search = body.resources?.search;
	return {
		limit: body.rate.limit,
		remaining: body.rate.remaining,
		used: body.rate.used,
		resetAt: body.rate.reset ? new Date(body.rate.reset * 1000).toISOString() : null,
		searchLimit: search?.limit ?? 0,
		searchRemaining: search?.remaining ?? 0,
		searchResetAt: search?.reset ? new Date(search.reset * 1000).toISOString() : null
	};
}
