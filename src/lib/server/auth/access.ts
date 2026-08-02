export type AccessRequirement = 'user' | 'admin' | null;

const REPO_ACTION_RE = /^\/api\/repo\/[^/]+\/[^/]+\/(?:actions|export)\/?$/;
const ARCHIVE_STORY_RE = /^\/api\/repos\/[^/]+\/archive-story\/regenerate\/?$/;
const DISCOVERY_REVIEW_RE = /^\/api\/discovery\/emerging(?:\/[^/]+)?\/?$/;

function isMutation(method: string): boolean {
	return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export function accessRequirement(pathname: string, method = 'GET'): AccessRequirement {
	if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
	if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) return 'admin';
	if (pathname === '/api/export' || pathname.startsWith('/api/export/')) return 'admin';
	if (REPO_ACTION_RE.test(pathname)) return 'admin';
	if (pathname === '/api/repo/save') return 'admin';
	if (ARCHIVE_STORY_RE.test(pathname)) return 'admin';
	if (DISCOVERY_REVIEW_RE.test(pathname) && isMutation(method)) return 'admin';
	if (pathname === '/api/me' || pathname.startsWith('/api/me/')) return 'user';
	if (pathname.startsWith('/api/snapshots/')) return 'user';
	return null;
}

export function requiresSameOrigin(pathname: string, method: string): boolean {
	return isMutation(method) && accessRequirement(pathname, method) !== null;
}
