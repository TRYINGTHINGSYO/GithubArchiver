export interface WebsiteVisitCandidate {
	final_url?: string | null;
}

/** Return an explicit, absolute HTTP(S) destination or no actionable URL. */
export function websiteVisitHref(site: WebsiteVisitCandidate): string | null {
	const candidate = site.final_url?.trim();
	if (!candidate) return null;

	try {
		const parsed = new URL(candidate);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
		return parsed.toString();
	} catch {
		return null;
	}
}
