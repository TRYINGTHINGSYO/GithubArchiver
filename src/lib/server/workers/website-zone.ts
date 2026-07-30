import { finishJobRun, startJobRun } from '../db/jobs.js';
import { upsertCandidateFromZone } from '../db/websites.js';
import {
	isAllowedWebsiteTld,
	toRegistrableDomain,
	websiteCtTlds
} from '../website-domain.js';
import { fetchWithTimeout, websiteFetchTimeoutMs, WebsiteFetchTimeoutError } from '../website-fetch.js';

export interface WebsiteZoneCycleResult {
	enabled: boolean;
	fetchedLines: number;
	inserted: number;
	updated: number;
	skipped: number;
	errors: string[];
}

/**
 * Optional new-registration feed (text/CSV, one domain per line or first CSV column).
 * Set WEBSITE_ZONE_FEED_URL to enable. CZDS/ccTLD onboarding is out of scope for v1.
 */
export async function runWebsiteZoneDiscoverCycle(): Promise<WebsiteZoneCycleResult> {
	const jobId = startJobRun('website_discover_zone', { phase: 'zone_feed' });
	const result: WebsiteZoneCycleResult = {
		enabled: false,
		fetchedLines: 0,
		inserted: 0,
		updated: 0,
		skipped: 0,
		errors: []
	};

	const feedUrl = process.env.WEBSITE_ZONE_FEED_URL?.trim();
	if (!feedUrl) {
		finishJobRun(jobId, 'success', { ...result, note: 'WEBSITE_ZONE_FEED_URL unset — skipped' });
		return result;
	}
	result.enabled = true;

	try {
		const timeoutMs = websiteFetchTimeoutMs('WEBSITE_ZONE_FETCH_TIMEOUT_MS', 60_000);
		const res = await fetchWithTimeout(feedUrl, {
			timeoutMs,
			headers: { 'User-Agent': 'GithubArchivePlus-WebsiteDiscover/0.1' }
		});
		if (!res.ok) throw new Error(`zone feed HTTP ${res.status}`);
		const text = await res.text();
		const lines = text.split(/\r?\n/);
		const tlds = websiteCtTlds();
		const limit = Math.max(1, Number(process.env.WEBSITE_ZONE_BATCH ?? 300));
		const seen = new Set<string>();

		for (const line of lines) {
			if (result.inserted + result.updated >= limit) break;
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			result.fetchedLines++;
			const raw = trimmed.split(/[,\t]/)[0]?.trim() ?? '';
			const registrable = toRegistrableDomain(raw);
			if (!registrable || !isAllowedWebsiteTld(registrable, tlds)) {
				result.skipped++;
				continue;
			}
			if (seen.has(registrable)) continue;
			seen.add(registrable);
			const outcome = upsertCandidateFromZone(registrable, registrable);
			if (outcome === 'inserted') result.inserted++;
			else result.updated++;
		}

		finishJobRun(jobId, 'success', result);
		return result;
	} catch (err) {
		const message =
			err instanceof WebsiteFetchTimeoutError
				? err.message
				: err instanceof Error
					? err.message
					: String(err);
		result.errors.push(message);
		finishJobRun(jobId, 'failed', result, message);
		return result;
	}
}
