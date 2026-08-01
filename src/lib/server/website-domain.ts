import { parse as parseDomain } from 'tldts';

/** Default TLD allowlist — intake filter so CT firehose cannot drown SQLite. */
export function websiteCtTlds(): string[] {
	const raw = process.env.WEBSITE_CT_TLDS ?? 'com,io,dev,app,ai,co,net,org';
	return raw
		.split(',')
		.map((t) => t.trim().toLowerCase().replace(/^\./, ''))
		.filter(Boolean);
}

export function isAllowedWebsiteTld(registrableDomain: string, tlds: string[] = websiteCtTlds()): boolean {
	const host = registrableDomain.toLowerCase();
	return tlds.some((tld) => host === tld || host.endsWith(`.${tld}`));
}

/**
 * Collapse hostname → registrable domain (eTLD+1).
 * Returns null for IP literals, empty, or unparseable names.
 */
export function toRegistrableDomain(hostname: string): string | null {
	const cleaned = hostname
		.trim()
		.toLowerCase()
		.replace(/^\*\./, '')
		.replace(/\.$/, '');
	if (!cleaned || cleaned.includes(' ') || /^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned)) {
		return null;
	}
	const parsed = parseDomain(cleaned);
	if (!parsed.domain || parsed.isIp || parsed.isPrivate) return null;
	return parsed.domain.toLowerCase();
}

/**
 * Normalize a route/API domain param to a registrable domain.
 * Rejects empty values, IPs, and unparseable hosts. Strips scheme, port, path,
 * query, and fragment so URL-shaped params cannot open-redirect or traverse.
 */
export function parseWebsiteRouteDomain(raw: string | null | undefined): string | null {
	if (raw == null) return null;
	let value: string;
	try {
		value = decodeURIComponent(String(raw)).trim();
	} catch {
		return null;
	}
	if (!value || value.length > 253) return null;
	if (/[\s\\]/.test(value) || value.includes('..')) return null;

	// Allow accidental URL-shaped params: keep host only.
	value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
	value = value.split(/[/?#]/)[0] ?? '';
	value = value.replace(/:\d+$/, '');
	value = value.replace(/^\*\./, '').replace(/\.$/, '').toLowerCase();
	if (!value || value.includes(':') || value.includes('@')) return null;

	return toRegistrableDomain(value);
}

/** Safe external visit URL for a known website row (never javascript:). */
export function websiteVisitHref(site: {
	registrable_domain: string;
	final_url?: string | null;
}): string {
	const finalUrl = site.final_url?.trim() ?? '';
	if (/^https?:\/\//i.test(finalUrl)) {
		try {
			const parsed = new URL(finalUrl);
			if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
				return parsed.toString();
			}
		} catch {
			/* fall through */
		}
	}
	return `https://${site.registrable_domain}/`;
}

/** Extract hostnames from a CT name_value / SAN blob (newline or comma separated). */
export function hostnamesFromCtNameValue(raw: string): string[] {
	return raw
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter(Boolean);
}
