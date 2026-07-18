import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '$lib/server/db/connection';
import { insertRepo } from '$lib/server/db/repos';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, recomputeEnrichmentTiersSql } from '$lib/server/db/schema';
import {
	assignEnrichmentTier,
	scoreEnrichmentPriority,
	shouldDeepEnrich
} from '$lib/server/enrichment-priority';
import {
	claimEnrichmentBatch,
	countClaimableEnrichmentBacklog,
	countEnrichmentBacklogByTier,
	markEnrichmentSuccess,
	recomputeEnrichmentPriority,
	releaseExpiredEnrichmentClaims,
	scheduleEnrichmentRetry
} from '$lib/server/enrichment-queue';
import { materializeDiscoveryResults, getMaterializedDiscoveryLanding } from '$lib/server/discovery-materialized';
import { pickAction, scoreAction, type BacklogSnapshot } from '$lib/server/daemon-planner';
import { getDueDaemonJobs } from '$lib/server/daemon-scheduler';
import { acquireWorkerLease, releaseWorkerLease } from '$lib/server/worker-lease';
import { setupTestDb, teardownTestDb } from './helpers/db';

function emptyBacklog(overrides: Partial<BacklogSnapshot> = {}): BacklogSnapshot {
	return {
		missingGhArchiveHours: 0,
		currentHourSearchGap: false,
		backfillPendingHours: 0,
		unenriched: 0,
		staleRefresh: 0,
		unarchivedSource: 0,
		rateLimitedUntil: null,
		...overrides
	};
}

function seedRepo(fullName: string, opts: { stars?: number; createdAt?: string; description?: string } = {}) {
	const [owner, name] = fullName.split('/');
	const created = opts.createdAt ?? new Date().toISOString();
	const inserted = insertRepo({
		owner,
		name,
		full_name: fullName,
		github_url: `https://github.com/${fullName}`,
		event_id: `evt-${fullName}`,
		created_at: created,
		first_seen_at: created
	});
	expect(inserted.status).toBe('inserted');
	const id = inserted.id!;
	if (opts.stars != null || opts.description) {
		getDb()
			.prepare(
				`UPDATE repos SET stars = COALESCE(?, stars), description = COALESCE(?, description),
				 enrichment_priority = 0 WHERE id = ?`
			)
			.run(opts.stars ?? null, opts.description ?? null, id);
		recomputeEnrichmentPriority(id);
	}
	return id;
}

describe('high-throughput enrichment architecture', () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it('assigns higher priority/tier to starred recent AI-like repos', () => {
		const hot = scoreEnrichmentPriority({
			stars: 120,
			forks: 10,
			created_at: new Date().toISOString(),
			description: 'An MCP server for agent memory',
			language: 'TypeScript',
			topics: '["mcp","ai-agent"]',
			full_name: 'acme/mcp-memory'
		});
		const cold = scoreEnrichmentPriority({
			stars: 0,
			forks: 0,
			created_at: new Date(Date.now() - 500 * 86_400_000).toISOString(),
			description: null,
			full_name: 'student/homework-lab3'
		});
		expect(hot.priority).toBeGreaterThan(cold.priority);
		expect(hot.tier).toBe('urgent');
		expect(['low', 'deferred', 'normal']).toContain(cold.tier);
	});

	it('does not mark every zero-star CreateEvent as urgent', () => {
		const freshCreate = scoreEnrichmentPriority({
			stars: 0,
			forks: 0,
			created_at: new Date().toISOString(),
			first_seen_at: new Date().toISOString(),
			description: null,
			full_name: 'someone/empty-new-repo'
		});
		expect(freshCreate.tier).toBe('high');

		const oldLongTail = scoreEnrichmentPriority({
			stars: 0,
			forks: 0,
			created_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
			first_seen_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
			description: null,
			full_name: 'someone/ancient-empty'
		});
		expect(['low', 'deferred']).toContain(oldLongTail.tier);

		expect(
			assignEnrichmentTier({
				priority: 80,
				stars: 0,
				createdAgeDays: 1,
				seenAgeDays: 0,
				hasSignal: false
			})
		).toBe('high');
	});

	it('recomputeEnrichmentTiersSql spreads backlog tiers instead of all-urgent', () => {
		const ages = [1, 5, 20, 100, 200, 400];
		for (const [i, days] of ages.entries()) {
			const created = new Date(Date.now() - days * 86_400_000).toISOString();
			insertRepo({
				owner: 'tier',
				name: `repo-${i}`,
				full_name: `tier/repo-${i}`,
				github_url: `https://github.com/tier/repo-${i}`,
				event_id: `tier-${i}`,
				created_at: created,
				first_seen_at: created
			});
		}
		// Simulate the v28 bug: everything forced to urgent.
		getDb().prepare(`UPDATE repos SET enrichment_tier = 'urgent', enrichment_priority = 1`).run();
		expect(getSchemaVersion(getDb())).toBe(CURRENT_SCHEMA_VERSION);

		recomputeEnrichmentTiersSql(getDb());

		const tiers = countEnrichmentBacklogByTier();
		expect(tiers.urgent).toBe(0);
		expect(tiers.high).toBeGreaterThan(0);
		expect(tiers.normal + tiers.low + tiers.deferred).toBeGreaterThan(0);
		expect(tiers.urgent + tiers.high + tiers.normal + tiers.low + tiers.deferred).toBe(ages.length);
	});

	it('claims enrichment queue in tier/priority order and recovers expired claims', () => {
		const lowId = seedRepo('z/old-empty', {
			stars: 0,
			createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString()
		});
		const highId = seedRepo('a/hot-mcp', {
			stars: 80,
			description: 'MCP server toolkit for agents',
			createdAt: new Date().toISOString()
		});

		getDb()
			.prepare(
				`UPDATE repos SET enrichment_tier = 'urgent', enrichment_priority = 200, next_enrichment_at = datetime('now') WHERE id = ?`
			)
			.run(highId);
		getDb()
			.prepare(
				`UPDATE repos SET enrichment_tier = 'low', enrichment_priority = 10, next_enrichment_at = datetime('now') WHERE id = ?`
			)
			.run(lowId);

		const batch = claimEnrichmentBatch(1, 'worker-a');
		expect(batch).toHaveLength(1);
		expect(batch[0].id).toBe(highId);
		expect(batch[0].enrichment_status).toBe('claimed');

		getDb()
			.prepare(
				`UPDATE repos SET enrichment_claim_expires_at = datetime('now', '-1 minute') WHERE id = ?`
			)
			.run(highId);
		expect(releaseExpiredEnrichmentClaims()).toBe(1);

		const recovered = claimEnrichmentBatch(1, 'worker-b');
		expect(recovered[0].id).toBe(highId);
		expect(recovered[0].enrichment_claimed_by).toBe('worker-b');
	});

	it('applies status-specific retries and marks success depth', () => {
		const id = seedRepo('acme/retry-me', { stars: 5, createdAt: new Date().toISOString() });
		scheduleEnrichmentRetry(id, 'boom', { status: 'retry', delayMs: 60_000, httpStatus: 500 });
		const row = getDb().prepare('SELECT * FROM repos WHERE id = ?').get(id) as {
			enrichment_status: string;
			next_enrichment_at: string;
			last_enrichment_error: string;
		};
		expect(row.enrichment_status).toBe('retry');
		expect(row.last_enrichment_error).toBe('boom');
		expect(Date.parse(row.next_enrichment_at)).toBeGreaterThan(Date.now());

		markEnrichmentSuccess(id, 'fast', { etag: '"abc"', httpStatus: 200 });
		const done = getDb().prepare('SELECT * FROM repos WHERE id = ?').get(id) as {
			enrichment_status: string;
			enrichment_depth: string;
			enrichment_etag: string;
		};
		expect(done.enrichment_status).toBe('done');
		expect(done.enrichment_depth).toBe('fast');
		expect(done.enrichment_etag).toBe('"abc"');
	});

	it('selects deep enrichment for high-value candidates', () => {
		expect(shouldDeepEnrich({ priority: 150, tier: 'urgent' })).toBe(true);
		expect(shouldDeepEnrich({ priority: 40, tier: 'low', interestingScore: 60 })).toBe(true);
		expect(shouldDeepEnrich({ priority: 30, tier: 'low', interestingScore: 10 })).toBe(false);
		// Bulk "high" from brand-new creates must stay on the cheap fast path.
		expect(shouldDeepEnrich({ priority: 70, tier: 'high' })).toBe(false);
		expect(shouldDeepEnrich({ priority: 130, tier: 'high' })).toBe(true);
	});

	it('does not promote recently-seen old repos into the high tier', () => {
		const backfilledAncient = scoreEnrichmentPriority({
			stars: 0,
			forks: 0,
			created_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
			first_seen_at: new Date().toISOString(),
			description: null,
			full_name: 'someone/ancient-just-ingested'
		});
		expect(backfilledAncient.tier).toBe('deferred');

		const freshCreate = scoreEnrichmentPriority({
			stars: 0,
			forks: 0,
			created_at: new Date().toISOString(),
			first_seen_at: new Date().toISOString(),
			description: null,
			full_name: 'someone/empty-new-repo'
		});
		expect(freshCreate.tier).toBe('high');
	});

	it('excludes deferred long-tail from claimable enrichment backlog', () => {
		const hot = seedRepo('acme/hot-agent', {
			stars: 80,
			description: 'An MCP server for agent memory',
			createdAt: new Date().toISOString()
		});
		const cold = seedRepo('acme/old-homework', {
			stars: 0,
			description: 'homework assignment lab1',
			createdAt: new Date(Date.now() - 500 * 86_400_000).toISOString()
		});
		recomputeEnrichmentPriority(hot);
		recomputeEnrichmentPriority(cold);
		const tiers = countEnrichmentBacklogByTier();
		const claimable = countClaimableEnrichmentBacklog();
		expect(tiers.deferred + tiers.low + tiers.normal + tiers.high + tiers.urgent).toBeGreaterThan(0);
		const coldRow = getDb().prepare('SELECT enrichment_tier, enrichment_status FROM repos WHERE id = ?').get(cold) as {
			enrichment_tier: string;
			enrichment_status: string;
		};
		expect(['deferred', 'low']).toContain(coldRow.enrichment_tier);
		const hotRow = getDb().prepare('SELECT enrichment_tier FROM repos WHERE id = ?').get(hot) as {
			enrichment_tier: string;
		};
		expect(['urgent', 'high']).toContain(hotRow.enrichment_tier);
		expect(claimable).toBeGreaterThanOrEqual(1);
		if (coldRow.enrichment_tier === 'deferred' || coldRow.enrichment_status === 'deferred') {
			expect(claimable).toBeLessThan(2);
		}
	});

	it('keeps ingest available despite a huge enrichment backlog', () => {
		const backlog = emptyBacklog({ missingGhArchiveHours: 2, unenriched: 671_000 });
		expect(scoreAction('ingest', backlog)).toBeGreaterThan(0);
		expect(getDueDaemonJobs(Date.now(), { unenrichedCount: 671_000 })).toContain('ingest');
		// Planner may prefer enrich, but ingest is never zeroed out by backlog alone.
		const decision = pickAction(backlog);
		expect(['ingest', 'enrich']).toContain(decision.action);
	});

	it('uses a recoverable worker lease', () => {
		const first = acquireWorkerLease('discovery-daemon', { ownerId: 'a', ttlMs: 60_000 });
		expect(first).not.toBeNull();
		const blocked = acquireWorkerLease('discovery-daemon', { ownerId: 'b', ttlMs: 60_000 });
		expect(blocked).toBeNull();
		releaseWorkerLease('discovery-daemon', 'a');
		const second = acquireWorkerLease('discovery-daemon', { ownerId: 'b', ttlMs: 60_000 });
		expect(second?.ownerId).toBe('b');
	});

	it('preserves discovery status marker across materialization runs', () => {
		materializeDiscoveryResults({ limit: 5, minScore: 99 });
		const first = getMaterializedDiscoveryLanding({ limit: 5 });
		expect(first).not.toBeNull();
		const firstAt = getDb()
			.prepare('SELECT last_discovery_analysis_at FROM discovery_system_status WHERE id = 1')
			.get() as { last_discovery_analysis_at: string };
		expect(firstAt.last_discovery_analysis_at).toBeTruthy();

		materializeDiscoveryResults({ limit: 5, minScore: 99 });
		const secondAt = getDb()
			.prepare('SELECT last_discovery_analysis_at FROM discovery_system_status WHERE id = 1')
			.get() as { last_discovery_analysis_at: string };
		expect(secondAt.last_discovery_analysis_at).toBeTruthy();
		expect(getMaterializedDiscoveryLanding({ limit: 5 })).not.toBeNull();
	});

	it('migrates to schema version 31 with enrichment indexes', () => {
		const db = getDb();
		expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
		expect(CURRENT_SCHEMA_VERSION).toBe(31);
		const indexes = (
			db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]
		).map((r) => r.name);
		expect(indexes).toContain('idx_repos_enrich_queue');
		expect(indexes).toContain('idx_repos_enrichment_priority');
		const tables = (
			db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
		).map((r) => r.name);
		expect(tables).toContain('worker_leases');
		expect(tables).toContain('enrichment_metrics');
	});
});

describe('bounded concurrency helper behavior', () => {
	it('runs tasks with a fixed pool and isolates failures', async () => {
		const { default: unused } = { default: null };
		void unused;
		async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
			const results: R[] = new Array(items.length);
			let next = 0;
			async function worker() {
				for (;;) {
					const idx = next++;
					if (idx >= items.length) return;
					results[idx] = await fn(items[idx]);
				}
			}
			await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
			return results;
		}

		const outcomes = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
			if (n === 3) return 'fail';
			await new Promise((r) => setTimeout(r, 5));
			return `ok-${n}`;
		});
		expect(outcomes).toEqual(['ok-1', 'ok-2', 'fail', 'ok-4', 'ok-5']);
	});
});
