/**
 * Shared UI helpers for public/admin status surfaces.
 * Kept outside $lib/server so Svelte client components can import them.
 */

export function formatEnrichmentCounts(progress: {
	enrichedTotal: number;
	completed: number;
	remaining: number;
}): string {
	return `${progress.enrichedTotal.toLocaleString()} enriched · ${progress.completed.toLocaleString()} this run · ${progress.remaining.toLocaleString()} waiting`;
}

/**
 * Human-readable job type for admin tables.
 * Distinguishes the long-lived daemon loop from child ingest batches.
 */
export function formatJobTypeLabel(job: {
	job_type: string;
	detail_json: string;
	reason?: string | null;
}): string {
	let detail: Record<string, unknown> = {};
	try {
		detail = JSON.parse(job.detail_json) as Record<string, unknown>;
	} catch {
		detail = {};
	}

	const parentRaw = detail.parent_daemon_job_id;
	const parentId =
		typeof parentRaw === 'number'
			? parentRaw
			: typeof parentRaw === 'string'
				? Number(parentRaw)
				: null;
	const parentSuffix =
		parentId != null && Number.isFinite(parentId) ? ` · daemon #${parentId}` : '';

	if (job.job_type === 'daemon') {
		const phase = typeof detail.phase === 'string' ? detail.phase : null;
		return phase ? `daemon (loop · ${phase})` : 'daemon (loop)';
	}

	if (job.job_type === 'ingest') {
		const action =
			(typeof detail.daemon_action === 'string' && detail.daemon_action) ||
			(typeof detail.action === 'string' && detail.action) ||
			(typeof detail.mode === 'string' && detail.mode) ||
			null;
		if (action === 'search_gap' || action === 'search') {
			return `ingest · search fallback${parentSuffix}`;
		}
		if (action === 'trending') return `ingest · trending${parentSuffix}`;
		if (action === 'single_hour') return `ingest · hour${parentSuffix}`;
		return `ingest batch${parentSuffix}`;
	}

	if (job.job_type === 'pipeline') {
		const phase = typeof detail.phase === 'string' ? detail.phase : null;
		return phase ? `pipeline · ${phase}` : 'pipeline';
	}

	return job.job_type;
}
