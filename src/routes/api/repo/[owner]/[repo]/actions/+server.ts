import { json } from '@sveltejs/kit';
import { archiveRepo, getArchiveConfigFromEnv } from '$lib/server/archiver';
import { getArchiveSnapshotById, getRepoBySlug, listArchiveSnapshots } from '$lib/server/db';
import { enrichRepo, refreshRepo } from '$lib/server/enrich';
import { analyzeSourceSnapshot, clearSourceAnalysisCache } from '$lib/server/source-archive';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const repo = getRepoBySlug(params.owner, params.repo);
	if (!repo) {
		return json({ ok: false, error: `Repository ${params.owner}/${params.repo} not found` }, { status: 404 });
	}

	const body = (await request.json().catch(() => ({}))) as { action?: string };
	const action = body.action ?? '';

	if (action === 'refresh') {
		if (repo.enriched_at) {
			const result = await refreshRepo(repo);
			return json({ ok: true, action, message: 'Metadata refreshed.', metricsChanged: result.metricsChanged });
		}
		await enrichRepo(repo);
		return json({ ok: true, action, message: 'Metadata enriched.' });
	}

	if (action === 'archive') {
		if (!repo.enriched_at || !repo.default_branch) {
			return json(
				{ ok: false, error: 'Refresh metadata before archiving so the default branch is known.' },
				{ status: 409 }
			);
		}
		const result = await archiveRepo(repo, getArchiveConfigFromEnv());
		return json({ ok: true, action, result });
	}

	if (action === 'reanalyze-source') {
		const latestSource = listArchiveSnapshots(repo.id).find((snapshot) => snapshot.snapshot_type === 'source');
		if (!latestSource) {
			return json({ ok: false, error: 'No source snapshot exists for this repository.' }, { status: 404 });
		}
		clearSourceAnalysisCache(latestSource.id);
		const snapshot = getArchiveSnapshotById(latestSource.id);
		const analysis = analyzeSourceSnapshot(snapshot);
		return json({
			ok: true,
			action,
			message: analysis?.available ? 'Source analysis refreshed.' : (analysis?.error ?? 'Source analysis unavailable.'),
			analysis
		});
	}

	return json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
};
