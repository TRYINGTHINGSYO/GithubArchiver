export const WEBSITE_PAGE_SIZE = 24;

export interface ParsedWebsitePage {
	page: number;
	valid: boolean;
}

/** Parse only canonical finite positive integers; invalid input normalizes to page one. */
export function parseWebsitePage(value: string | null): ParsedWebsitePage {
	if (value == null) return { page: 1, valid: true };
	const normalized = value.trim();
	if (!/^[1-9]\d*$/.test(normalized)) return { page: 1, valid: false };
	const page = Number(normalized);
	if (!Number.isSafeInteger(page)) return { page: Number.MAX_SAFE_INTEGER, valid: false };
	return { page, valid: true };
}

export function canonicalWebsitePageUrl(url: URL, page: number): string {
	const params = new URLSearchParams(url.searchParams);
	if (page <= 1) params.delete('page');
	else params.set('page', String(page));
	const query = params.toString();
	return query ? `${url.pathname}?${query}` : url.pathname;
}
