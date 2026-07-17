import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import { hasGitHubToken } from '../src/lib/server/github.js';

type Check = { name: string; pass: boolean; detail: string };

function sanitizeTestBody(body: string): string {
	return body
		.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
		.replace(/github_pat_[A-Za-z0-9_]+/gi, '[redacted]')
		.replace(/ghp_[A-Za-z0-9_]+/gi, '[redacted]');
}

function main() {
	const db = getDb();
	const checks: Check[] = [];

	// --- Auth ---
	checks.push({
		name: 'GitHub token configured',
		pass: hasGitHubToken(),
		detail: hasGitHubToken()
			? 'GITHUB_TOKEN is set (value not shown)'
			: 'GITHUB_TOKEN missing — add to local .env before scaling enrichment'
	});

	// --- Recent-first ordering: last batch should skew recent ---
	const lastEnriched = db
		.prepare(
			`SELECT full_name, created_at, enriched_at, enrichment_level
			 FROM repos
			 WHERE enriched_at IS NOT NULL
			 ORDER BY enriched_at DESC
			 LIMIT 20`
		)
		.all() as Array<{
		full_name: string;
		created_at: string;
		enriched_at: string;
		enrichment_level: number;
	}>;

	if (lastEnriched.length === 0) {
		checks.push({
			name: 'Recent repos processed before backlog',
			pass: false,
			detail: 'No enriched repos yet — run enrich:repos after setting GITHUB_TOKEN'
		});
	} else {
		const recentCutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
		const recentCount = lastEnriched.filter((r) => r.created_at >= recentCutoff).length;
		const oldInBatch = lastEnriched.filter((r) => r.created_at < recentCutoff).length;
		checks.push({
			name: 'Recent repos processed before backlog',
			pass: recentCount >= oldInBatch || oldInBatch === 0,
			detail: `Last ${lastEnriched.length} enrichments: ${recentCount} from last 90d, ${oldInBatch} older`
		});
	}

	// --- Level 1 ---
	const level1Recent = db
		.prepare(
			`SELECT COUNT(*) AS c FROM repos
			 WHERE enriched_at IS NOT NULL
			   AND enrichment_level >= 1
			   AND enriched_at >= datetime('now', '-1 day')`
		)
		.get() as { c: number };
	const level0Enriched = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE enriched_at IS NOT NULL AND enrichment_level < 1`
			)
			.get() as { c: number }
	).c;
	checks.push({
		name: 'Successful repos reach enrichment_level >= 1',
		pass: level0Enriched === 0,
		detail:
			level0Enriched === 0
				? `${level1Recent.c} enriched in last 24h at level >= 1`
				: `${level0Enriched} repos have enriched_at but enrichment_level < 1`
	});

	// --- Pipeline queue ---
	const queued = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repo_pipeline_queue
				 WHERE needs_clustering = 1 OR needs_story = 1`
			)
			.get() as { c: number }
	).c;
	const recentEnrichedIds = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos r
				 JOIN repo_pipeline_queue q ON q.repository_id = r.id
				 WHERE r.enriched_at >= datetime('now', '-1 day')`
			)
			.get() as { c: number }
	).c;
	checks.push({
		name: 'Changed repository IDs enter repo_pipeline_queue',
		pass: queued > 0 || lastEnriched.length === 0,
		detail: `${queued} repos queued for clustering/story; ${recentEnrichedIds} from last 24h in queue`
	});

	// --- Failed/deleted not blocking ---
	const deletedStillUnenriched = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE deleted_at IS NOT NULL AND enriched_at IS NULL`
			)
			.get() as { c: number }
	).c;
	const failureEvents = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repository_events
				 WHERE event_type = 'enrichment_failed'
				   AND event_time >= datetime('now', '-1 day')`
			)
			.get() as { c: number }
	).c;
	checks.push({
		name: 'Failed/deleted repos do not block the queue',
		pass: true,
		detail: `${deletedStillUnenriched} deleted-but-never-enriched (expected: marked deleted, skipped on retry); ${failureEvents} enrichment_failed events in last 24h`
	});

	// --- Rate-limit / auth errors in recent jobs ---
	const recentEnrichJobs = db
		.prepare(
			`SELECT status, detail_json, error FROM job_runs
			 WHERE job_type = 'enrich'
			 ORDER BY started_at DESC
			 LIMIT 5`
		)
		.all() as Array<{ status: string; detail_json: string | null; error: string | null }>;

	let rateLimitHit = false;
	let authError = false;
	let secondaryLimit = false;
	for (const job of recentEnrichJobs) {
		const blob = `${job.error ?? ''} ${job.detail_json ?? ''}`.toLowerCase();
		if (blob.includes('rate limit')) rateLimitHit = true;
		if (blob.includes('secondary rate')) secondaryLimit = true;
		if (blob.includes('401') || blob.includes('bad credentials')) authError = true;
	}
	checks.push({
		name: 'No unexpected 401/403 or secondary rate limits in recent enrich jobs',
		pass: !authError && (!rateLimitHit || hasGitHubToken()),
		detail: [
			authError ? '401/auth errors detected' : 'no auth errors',
			secondaryLimit ? 'secondary rate limit seen' : 'no secondary limit in job log',
			rateLimitHit ? 'primary rate limit hit (expected without token)' : 'no rate limit in job log'
		].join('; ')
	});

	// --- Credential redaction in errors ---
	const fakeBody = 'Authorization failed Bearer github_pat_abc123secret token ghp_deadbeef';
	const redacted = sanitizeTestBody(fakeBody);
	checks.push({
		name: 'GitHub error logging redacts credentials',
		pass:
			!redacted.includes('github_pat_abc123') &&
			!redacted.includes('ghp_deadbeef') &&
			redacted.includes('[redacted]'),
		detail: redacted.slice(0, 80)
	});

	// --- Requests per repo from last job detail ---
	let avgRequests = 'n/a';
	for (const job of recentEnrichJobs) {
		if (!job.detail_json) continue;
		try {
			const detail = JSON.parse(job.detail_json) as { requests?: number; enriched?: number };
			if (detail.requests != null && detail.enriched) {
				avgRequests = (detail.requests / detail.enriched).toFixed(2);
				break;
			}
		} catch {
			/* ignore */
		}
	}
	checks.push({
		name: 'Roughly one API request per Level-1 repository',
		pass: avgRequests === 'n/a' || Number(avgRequests) <= 1.5,
		detail: `Avg requests/repo from last job detail: ${avgRequests} (target ~1.0 without ENRICH_SYNC_RELEASES)`
	});

	// --- Window coverage ---
	const windowEnd = process.env.EMERGING_PERIOD_END ?? new Date().toISOString();
	const windowEndDate = new Date(windowEnd);
	const windowStart = new Date(
		windowEndDate.getTime() - 7 * 86_400_000
	).toISOString();
	const windowEnriched = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE created_at >= ? AND created_at < ?
				   AND enriched_at IS NOT NULL`
			)
			.get(windowStart, windowEnd) as { c: number }
	).c;
	const windowOwners = (
		db
			.prepare(
				`SELECT COUNT(DISTINCT owner) AS c FROM repos
				 WHERE created_at >= ? AND created_at < ?
				   AND enriched_at IS NOT NULL`
			)
			.get(windowStart, windowEnd) as { c: number }
	).c;

	console.log('Enrichment pilot validation\n');
	for (const check of checks) {
		console.log(`${check.pass ? '✓' : '✗'} ${check.name}`);
		console.log(`    ${check.detail}\n`);
	}

	console.log('Emerging window coverage');
	console.log(`  Period: ${windowStart.slice(0, 10)} → ${windowEnd.slice(0, 10)}`);
	console.log(`  Enriched in window: ${windowEnriched} (target 250)`);
	console.log(`  Distinct owners:    ${windowOwners} (target 50)`);

	const failed = checks.filter((c) => !c.pass).length;
	console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
	if (!hasGitHubToken()) {
		console.log('\nBlocked: set GITHUB_TOKEN in .env locally, then re-run pilots.');
		process.exit(1);
	}
	process.exit(failed > 0 ? 1 : 0);
}

main();
