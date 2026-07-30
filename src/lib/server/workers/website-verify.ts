import { finishJobRun, startJobRun } from '../db/jobs.js';
import { listPendingVerifyDomains, recordWebsiteVerifyResult } from '../db/websites.js';
import { extractHtmlTitle, looksParked } from '../website-parked.js';
import { fetchWithTimeout, websiteFetchTimeoutMs, WebsiteFetchTimeoutError } from '../website-fetch.js';

export interface WebsiteVerifyCycleResult {
	planned: number;
	live: number;
	parked: number;
	dead: number;
	error: number;
	errors: string[];
}

function verifyBatchSize(): number {
	const n = Number(process.env.WEBSITE_VERIFY_BATCH ?? 20);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

async function verifyOneDomain(domain: string): Promise<{
	status: 'live' | 'parked' | 'dead' | 'error';
	httpStatus?: number;
	finalUrl?: string;
	pageTitle?: string | null;
	error?: string;
}> {
	const timeoutMs = websiteFetchTimeoutMs('WEBSITE_VERIFY_FETCH_TIMEOUT_MS', 12_000);
	const urls = [`https://${domain}/`, `http://${domain}/`];

	let lastError = 'no response';
	for (const url of urls) {
		try {
			const res = await fetchWithTimeout(url, {
				timeoutMs,
				redirect: 'follow',
				headers: {
					'User-Agent': 'GithubArchivePlus-WebsiteVerify/0.1',
					Accept: 'text/html,application/xhtml+xml'
				}
			});
			const finalUrl = res.url || url;
			const httpStatus = res.status;
			if (httpStatus >= 500) {
				lastError = `HTTP ${httpStatus}`;
				continue;
			}
			if (httpStatus === 404 || httpStatus === 410) {
				return { status: 'dead', httpStatus, finalUrl, error: `HTTP ${httpStatus}` };
			}

			const buf = await res.arrayBuffer();
			const sample = Buffer.from(buf).subarray(0, 24_000).toString('utf8');
			const pageTitle = extractHtmlTitle(sample);
			if (looksParked({ title: pageTitle, bodySample: sample, finalUrl })) {
				return { status: 'parked', httpStatus, finalUrl, pageTitle };
			}
			if (httpStatus >= 200 && httpStatus < 400) {
				return { status: 'live', httpStatus, finalUrl, pageTitle };
			}
			lastError = `HTTP ${httpStatus}`;
		} catch (err) {
			if (err instanceof WebsiteFetchTimeoutError) {
				lastError = err.message;
			} else {
				lastError = err instanceof Error ? err.message : String(err);
			}
		}
	}
	return { status: 'error', error: lastError };
}

export async function runWebsiteVerifyCycle(): Promise<WebsiteVerifyCycleResult> {
	const jobId = startJobRun('website_verify', { phase: 'liveness' });
	const result: WebsiteVerifyCycleResult = {
		planned: 0,
		live: 0,
		parked: 0,
		dead: 0,
		error: 0,
		errors: []
	};

	try {
		const pending = listPendingVerifyDomains(verifyBatchSize());
		result.planned = pending.length;

		for (const row of pending) {
			const outcome = await verifyOneDomain(row.registrable_domain);
			recordWebsiteVerifyResult(row.registrable_domain, {
				status: outcome.status,
				httpStatus: outcome.httpStatus ?? null,
				finalUrl: outcome.finalUrl ?? null,
				pageTitle: outcome.pageTitle ?? null,
				error: outcome.error ?? null
			});
			if (outcome.status === 'live') result.live++;
			else if (outcome.status === 'parked') result.parked++;
			else if (outcome.status === 'dead') result.dead++;
			else {
				result.error++;
				if (outcome.error) result.errors.push(`${row.registrable_domain}: ${outcome.error}`);
			}
		}

		finishJobRun(jobId, 'success', result);
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		result.errors.push(message);
		finishJobRun(jobId, 'failed', result, message);
		return result;
	}
}
