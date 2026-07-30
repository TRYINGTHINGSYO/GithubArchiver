const PARKED_TITLE_RE =
	/\b(parked|buy this domain|domain (is )?for sale|domain has expired|this domain is available|hugedomains|sedo|godaddy|namecheap|afternic|dan\.com)\b/i;

const PARKED_BODY_RE =
	/\b(this domain is parked|buy this domain|domain parking|parked free|related searches|enquiry\.sedo|hugedomains\.com|afternic\.com)\b/i;

const PARKING_HOST_RE =
	/(^|\.)(sedoparking|parkingcrew|godaddy|hugedomains|afternic|dan\.com|namebright|bodis|above\.com)\./i;

export function looksParked(opts: {
	title?: string | null;
	bodySample?: string | null;
	finalUrl?: string | null;
}): boolean {
	if (opts.title && PARKED_TITLE_RE.test(opts.title)) return true;
	if (opts.finalUrl) {
		try {
			const host = new URL(opts.finalUrl).hostname;
			if (PARKING_HOST_RE.test(host)) return true;
		} catch {
			/* ignore */
		}
	}
	const body = opts.bodySample ?? '';
	if (body.length > 0 && body.length < 800 && PARKED_BODY_RE.test(body)) return true;
	if (body.length > 0 && PARKED_BODY_RE.test(body.slice(0, 4000))) return true;
	return false;
}

export function extractHtmlTitle(html: string): string | null {
	const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
	if (!m?.[1]) return null;
	return m[1].replace(/\s+/g, ' ').trim().slice(0, 300) || null;
}
