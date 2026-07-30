import { finishJobRun, startJobRun } from '../db/jobs.js';
import {
	getWebsitePipelineState,
	setWebsitePipelineState,
	upsertCandidateFromCt
} from '../db/websites.js';
import {
	hostnamesFromCtNameValue,
	isAllowedWebsiteTld,
	toRegistrableDomain,
	websiteCtTlds
} from '../website-domain.js';
import { fetchWithTimeout, websiteFetchTimeoutMs, WebsiteFetchTimeoutError } from '../website-fetch.js';

export interface WebsiteCtCycleResult {
	tldsPolled: string[];
	fetched: number;
	inserted: number;
	updated: number;
	skipped: number;
	errors: string[];
}

interface CrtShRow {
	id?: number;
	common_name?: string;
	name_value?: string;
	entry_timestamp?: string;
}

function ctBatchLimit(): number {
	const n = Number(process.env.WEBSITE_CT_BATCH ?? 150);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 150;
}

function nextTldIndex(): number {
	const raw = getWebsitePipelineState('ct_tld_index');
	const n = Number(raw ?? 0);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Poll crt.sh for one allowlisted TLD (rotating). Upsert eTLD+1 into candidate_domains.
 * Not a live CT tail — periodic aggregator poll by design.
 */
export async function runWebsiteCtDiscoverCycle(): Promise<WebsiteCtCycleResult> {
	const jobId = startJobRun('website_discover_ct', { phase: 'crt_sh_poll' });
	const result: WebsiteCtCycleResult = {
		tldsPolled: [],
		fetched: 0,
		inserted: 0,
		updated: 0,
		skipped: 0,
		errors: []
	};

	try {
		const tlds = websiteCtTlds();
		if (tlds.length === 0) {
			finishJobRun(jobId, 'success', result);
			return result;
		}

		const idx = nextTldIndex() % tlds.length;
		const tld = tlds[idx]!;
		setWebsitePipelineState('ct_tld_index', String(idx + 1));
		result.tldsPolled = [tld];

		const url = `https://crt.sh/?q=${encodeURIComponent(`%.${tld}`)}&output=json`;
		const timeoutMs = websiteFetchTimeoutMs('WEBSITE_CT_FETCH_TIMEOUT_MS', 45_000);
		const res = await fetchWithTimeout(url, {
			timeoutMs,
			headers: { Accept: 'application/json', 'User-Agent': 'GithubArchivePlus-WebsiteDiscover/0.1' }
		});
		if (!res.ok) {
			throw new Error(`crt.sh HTTP ${res.status}`);
		}
		const text = await res.text();
		let rows: CrtShRow[] = [];
		try {
			rows = JSON.parse(text) as CrtShRow[];
		} catch {
			throw new Error('crt.sh returned non-JSON (rate limited or HTML error page)');
		}
		if (!Array.isArray(rows)) rows = [];

		const lastId = Number(getWebsitePipelineState(`ct_last_id_${tld}`) ?? 0);
		let maxId = lastId;
		const limit = ctBatchLimit();
		const seen = new Set<string>();

		// Prefer newer ids when present.
		const ordered = [...rows].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));

		for (const row of ordered) {
			if (result.inserted + result.updated >= limit) break;
			const id = Number(row.id ?? 0);
			if (id && id <= lastId) continue;
			if (id > maxId) maxId = id;

			const names = [
				...(row.common_name ? [row.common_name] : []),
				...hostnamesFromCtNameValue(row.name_value ?? '')
			];
			result.fetched++;

			for (const name of names) {
				const registrable = toRegistrableDomain(name);
				if (!registrable || !isAllowedWebsiteTld(registrable, tlds)) {
					result.skipped++;
					continue;
				}
				if (seen.has(registrable)) continue;
				seen.add(registrable);
				const outcome = upsertCandidateFromCt(registrable, name.toLowerCase());
				if (outcome === 'inserted') result.inserted++;
				else result.updated++;
			}
		}

		if (maxId > lastId) {
			setWebsitePipelineState(`ct_last_id_${tld}`, String(maxId));
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
