export interface GithubRepoRef {
	owner: string;
	name: string;
}

/** Parse `owner/name` or a github.com URL into a repo ref. */
export function parseGithubRepoRef(input: string): GithubRepoRef | null {
	const raw = input.trim();
	if (!raw) return null;

	let path = raw;
	try {
		if (/^https?:\/\//i.test(raw) || raw.startsWith('github.com/')) {
			const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
			if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
			path = url.pathname;
		}
	} catch {
		return null;
	}

	const cleaned = path
		.replace(/^\/+/, '')
		.replace(/\.git$/i, '')
		.split(/[?#]/)[0]!;
	const parts = cleaned.split('/').filter(Boolean);
	if (parts.length < 2) return null;

	const owner = parts[0]!;
	const name = parts[1]!;
	if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;
	if (owner === '.' || owner === '..' || name === '.' || name === '..') return null;

	return { owner, name };
}
