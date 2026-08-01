import { computeDataReadiness } from './data-readiness.js';
import { getNewHighSignalRepos, type DiscoveryRepoCard } from './discovery.js';
import { getDb } from './db/connection.js';
import { countRepos } from './db/repos.js';
import {
	completeHomepageReadinessRun,
	getPublishedHomepageReadinessSnapshot,
	isHomepageReadinessSnapshotFresh,
	publishHomepageReadinessSnapshot,
	readHomepageSourceWatermarks,
	tryClaimHomepageReadinessRun,
	type HomepageReadinessPublishedSnapshot
} from './homepage-readiness-materialization.js';

export interface MaterializeHomepageReadinessResult {
	status: 'success' | 'skipped_deduped' | 'failed';
	runId: number | null;
	snapshotRunId: number | null;
	highSignalCount: number;
	highSignalRows: number;
	error?: string;
}

function countHighSignalReposLive(): number {
	return (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE COALESCE(signal_tier, 'normal') IN ('normal', 'high')
				   AND deleted_at IS NULL
				   AND interesting_score IS NOT NULL`
			)
			.get() as { c: number }
	).c;
}

/**
 * Compute readiness + high-signal from the same cycle and publish atomically.
 * Failed refreshes leave the previous singleton snapshot untouched.
 */
export function materializeHomepageReadiness(
	opts: {
		windowDays?: number;
		highSignalLimit?: number;
		minScore?: number;
		owner?: string;
		skipClaim?: boolean;
	} = {}
): MaterializeHomepageReadinessResult {
	const windowDays = opts.windowDays ?? 7;
	const highSignalLimit = opts.highSignalLimit ?? 8;
	const minScore = opts.minScore ?? 55;

	const claim = opts.skipClaim
		? ({ claimed: true, runId: -1, owner: opts.owner ?? 'direct' } as const)
		: tryClaimHomepageReadinessRun({ owner: opts.owner });
	if (!claim.claimed) {
		return {
			status: 'skipped_deduped',
			runId: claim.activeRunId,
			snapshotRunId: getPublishedHomepageReadinessSnapshot()?.runId ?? null,
			highSignalCount: 0,
			highSignalRows: 0
		};
	}

	const runId = claim.runId;
	try {
		const periodEnd = new Date();
		const readiness = computeDataReadiness({
			windowDays,
			periodEnd,
			minEnriched: 250,
			minOwners: 50
		});
		const highSignalRepos = getNewHighSignalRepos({
			limit: highSignalLimit,
			minScore
		});
		const highSignalCount = countHighSignalReposLive();
		const watermarks = readHomepageSourceWatermarks();
		const publishedAt = new Date().toISOString();

		getDb().transaction(() => {
			publishHomepageReadinessSnapshot({
				runId,
				windowDays,
				readiness,
				highSignalRepos,
				highSignalCount,
				watermarks,
				publishedAt
			});
		})();

		completeHomepageReadinessRun(runId, {
			status: 'success',
			published: true,
			snapshotId: 1
		});

		return {
			status: 'success',
			runId: runId < 0 ? null : runId,
			snapshotRunId: runId < 0 ? 0 : runId,
			highSignalCount,
			highSignalRows: highSignalRepos.length
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		completeHomepageReadinessRun(runId, {
			status: 'failed',
			error: message,
			published: false
		});
		return {
			status: 'failed',
			runId: runId < 0 ? null : runId,
			snapshotRunId: getPublishedHomepageReadinessSnapshot()?.runId ?? null,
			highSignalCount: 0,
			highSignalRows: 0,
			error: message
		};
	}
}

export function getHomepageHighSignalRepos(opts: {
	limit?: number;
	minScore?: number;
} = {}): DiscoveryRepoCard[] {
	// Fresh install / wiped volume — never serve snapshot cards without live repos.
	if (countRepos() === 0) return [];
	const snapshot = getPublishedHomepageReadinessSnapshot();
	if (snapshot && isHomepageReadinessSnapshotFresh(snapshot)) {
		const limit = opts.limit ?? 8;
		return snapshot.highSignalRepos.slice(0, limit);
	}
	return getNewHighSignalRepos({
		limit: opts.limit ?? 8,
		minScore: opts.minScore ?? 55
	});
}

export function getHomepageHighSignalCount(): number {
	if (countRepos() === 0) return 0;
	const snapshot = getPublishedHomepageReadinessSnapshot();
	if (snapshot && isHomepageReadinessSnapshotFresh(snapshot)) {
		return snapshot.highSignalCount;
	}
	return countHighSignalReposLive();
}

export function getHomepageReadinessSnapshotForTests(): HomepageReadinessPublishedSnapshot | null {
	return getPublishedHomepageReadinessSnapshot();
}
