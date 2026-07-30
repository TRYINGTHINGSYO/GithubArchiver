/**
 * Read-only enrichment bottleneck measurement.
 *
 * Reports only what is already persisted — no new instrumentation, no writes.
 * Deliberately refuses to print a clearance estimate when net backlog burn is
 * zero or negative, because a negative burn has no completion date.
 *
 *   npx tsx scripts/measure-enrichment.ts [dbPath]
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const WINDOWS = [
  { label: "1h", hours: 1 },
  { label: "3h", hours: 3 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
];

/**
 * Timestamps are stored as JS ISO-8601 ('2026-07-30T22:07:43.973Z'), so they
 * must not be compared against datetime('now', ...) ('2026-07-30 21:09:30').
 * 'T' sorts above ' ', which makes every row from the current date match any
 * same-day cutoff and silently collapses every window to "today".
 */
function isoSince(hours: number): string {
	return new Date(Date.now() - hours * 3_600_000).toISOString();
}

const NOW_ISO = new Date().toISOString();

function resolveDbPath(): string {
  const explicit = process.argv[2] ?? process.env.DATABASE_PATH;
  if (explicit) return explicit;
  for (const candidate of [
    "/data/githubarchive.db",
    "./data/githubarchive.db",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("no database found; pass a path or set DATABASE_PATH");
}

const dbPath = resolveDbPath();
const db = new Database(dbPath, { readonly: true });
const all = <T>(sql: string, ...args: unknown[]) =>
  db.prepare(sql).all(...args) as T[];
const one = <T>(sql: string, ...args: unknown[]) =>
  db.prepare(sql).get(...args) as T | undefined;

function hr(title: string): void {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

function pad(v: unknown, n = 12): string {
  return String(v).padStart(n);
}

/**
 * Schemas differ between the dev copy and production, and a diagnostic that
 * dies on the first absent column tells you nothing about the rest of the
 * system. Every section reports its own failure and the run continues.
 */
function safe(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.log(`  !! ${label} unavailable: ${(err as Error).message}`);
  }
}

function hasTable(name: string): boolean {
  return (
    one<{ c: number }>(
      `SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name = ?`,
      name,
    )?.c === 1
  );
}

function hasColumn(table: string, column: string): boolean {
  if (!hasTable(table)) return false;
  return all<{ name: string }>(`PRAGMA table_info(${table})`).some(
    (c) => c.name === column,
  );
}

console.log(`db: ${dbPath}`);
console.log(`now: ${new Date().toISOString()}`);

// ---------------------------------------------------------------- corpus state
hr("CORPUS + BACKLOG");
const corpus = one<{
  total: number;
  enriched: number;
  unenriched: number;
  deleted: number;
}>(`SELECT COUNT(*) total,
           SUM(enriched_at IS NOT NULL) enriched,
           SUM(enriched_at IS NULL AND deleted_at IS NULL) unenriched,
           SUM(deleted_at IS NOT NULL) deleted
    FROM repos`);
console.log(corpus);
if (corpus) {
  console.log(
    `coverage: ${((corpus.enriched / corpus.total) * 100).toFixed(2)}%`,
  );
}

for (const col of ["enrichment_status", "enrichment_tier"]) {
  safe(col, () => {
    if (!hasColumn("repos", col))
      throw new Error("column absent on this schema");
    console.log(`\nby ${col} (unenriched only):`);
    for (const r of all<{ k: string; c: number }>(
      `SELECT COALESCE(${col},'(null)') k, COUNT(*) c
			 FROM repos WHERE enriched_at IS NULL AND deleted_at IS NULL
			 GROUP BY k ORDER BY c DESC`,
    )) {
      console.log(`  ${r.k.padEnd(14)}${pad(r.c)}`);
    }
  });
}

// Mirrors the claim filter in enrichment-queue.ts: what is actually claimable now.
safe("claimable", () => {
  const claimable = one<{ c: number }>(
    `SELECT COUNT(*) c FROM repos
		  WHERE enriched_at IS NULL AND deleted_at IS NULL
		    AND enrichment_status IN ('pending','retry')
		    AND enrichment_tier IN ('urgent','high','normal','low')
		    AND (next_enrichment_at IS NULL OR next_enrichment_at <= ?)
		    AND (enrichment_claim_expires_at IS NULL OR enrichment_claim_expires_at < ?)
		    AND enrichment_attempts < 5`,
    NOW_ISO,
    NOW_ISO,
  );
  console.log(`\nclaimable right now: ${claimable?.c}`);
  const inFlight = one<{ c: number }>(
    `SELECT COUNT(*) c FROM repos
		  WHERE enrichment_status = 'claimed'
		    AND enrichment_claim_expires_at > ?`,
    NOW_ISO,
  );
  console.log(`in-flight (claimed, unexpired): ${inFlight?.c}`);
});

// Corpus-wide coverage measures against a denominator the tiering policy never
// intends to enrich. Eligible coverage is the number that reflects pipeline health.
hr("ELIGIBLE-CORPUS COVERAGE");
safe("eligible coverage", () => {
  const eligible = one<{ enriched: number; pending: number }>(
    `SELECT SUM(enriched_at IS NOT NULL) enriched,
            SUM(enriched_at IS NULL AND deleted_at IS NULL
                AND COALESCE(enrichment_tier,'normal') != 'deferred') pending
     FROM repos`,
  );
  if (!eligible) return;
  const denom = eligible.enriched + eligible.pending;
  console.log(`enriched:            ${eligible.enriched}`);
  console.log(`eligible + pending:  ${eligible.pending}`);
  console.log(`eligible corpus:     ${denom}`);
  console.log(
    `eligible coverage:   ${((eligible.enriched / denom) * 100).toFixed(2)}%`,
  );

  console.log("\nif eligibility widened, how many deferred repos qualify:");
  for (const [label, where] of [
    ["stars >= 1", "stars >= 1"],
    ["stars >= 5", "stars >= 5"],
    ["stars >= 10", "stars >= 10"],
    ["interesting_score >= 40", "COALESCE(interesting_score,0) >= 40"],
    ["has description", "description IS NOT NULL AND length(description) > 0"],
  ] as const) {
    const r = one<{ c: number }>(
      `SELECT COUNT(*) c FROM repos
        WHERE enriched_at IS NULL AND deleted_at IS NULL
          AND COALESCE(enrichment_tier,'normal') = 'deferred'
          AND ${where}`,
    );
    console.log(`  ${label.padEnd(26)}${pad(r?.c ?? 0)}`);
  }
});

// ------------------------------------------------------- throughput + net burn
hr("THROUGHPUT / NET BACKLOG BURN");
console.log("window   completed    arrivals    net_burn   compl/hr   arriv/hr");
for (const w of WINDOWS) {
  const since = isoSince(w.hours);
  const completed =
    one<{ c: number }>(
      `SELECT COUNT(*) c FROM repos WHERE enriched_at >= ?`,
      since,
    )?.c ?? 0;
  // Newly eligible = newly discovered and not already enriched on arrival.
  const arrivals =
    one<{ c: number }>(
      `SELECT COUNT(*) c FROM repos WHERE first_seen_at >= ?`,
      since,
    )?.c ?? 0;
  const net = completed - arrivals;
  console.log(
    `${w.label.padEnd(8)}${pad(completed, 9)}${pad(arrivals, 12)}${pad(net, 12)}` +
      `${pad((completed / w.hours).toFixed(1), 11)}${pad((arrivals / w.hours).toFixed(1), 11)}`,
  );
}

const backlog = corpus?.unenriched ?? 0;
const burn24 =
  (one<{ c: number }>(
    `SELECT COUNT(*) c FROM repos WHERE enriched_at >= ?`,
    isoSince(24),
  )?.c ?? 0) -
  (one<{ c: number }>(
    `SELECT COUNT(*) c FROM repos WHERE first_seen_at >= ?`,
    isoSince(24),
  )?.c ?? 0);
console.log(`\nbacklog: ${backlog}`);
console.log(`net burn (24h): ${burn24}`);
if (burn24 > 0) {
  console.log(
    `clearance: ${(backlog / burn24).toFixed(1)} days at this burn rate`,
  );
} else {
  console.log(
    "clearance: NOT CALCULABLE — net burn is zero or negative (backlog is growing)",
  );
}

// ------------------------------------------------------------ daemon behaviour
hr("DAEMON DUTY CYCLE (job_runs finished in window)");
console.log(
  "note: sums overlapping runs, so duty% can exceed 100 when jobs nest",
);
for (const w of WINDOWS) {
  const since = isoSince(w.hours);
  const rows = all<{
    job_type: string;
    runs: number;
    total_sec: number;
    avg_sec: number;
  }>(
    `SELECT job_type, COUNT(*) runs,
		        ROUND(SUM((julianday(finished_at) - julianday(started_at)) * 86400), 1) total_sec,
		        ROUND(AVG((julianday(finished_at) - julianday(started_at)) * 86400), 1) avg_sec
		 FROM job_runs
		 WHERE finished_at IS NOT NULL AND finished_at >= ?
		 GROUP BY job_type ORDER BY total_sec DESC`,
    since,
  );
  const wall = w.hours * 3600;
  console.log(`\n-- last ${w.label} (wall ${wall}s)`);
  console.log("job_type        runs    total_sec   avg_sec   duty%");
  for (const r of rows) {
    const duty = ((r.total_sec / wall) * 100).toFixed(1);
    console.log(
      `${r.job_type.padEnd(14)}${pad(r.runs, 6)}${pad(r.total_sec, 12)}${pad(r.avg_sec, 10)}${pad(duty, 8)}`,
    );
  }
}

hr("PLANNER DECISIONS (daemon_decisions)");
safe("daemon_decisions", () => {
  for (const w of WINDOWS) {
    const rows = all<{ action: string; c: number }>(
      `SELECT action, COUNT(*) c FROM daemon_decisions
			 WHERE decided_at >= ? GROUP BY action ORDER BY c DESC`,
      isoSince(w.hours),
    );
    const total = rows.reduce((s, r) => s + r.c, 0);
    console.log(`\n-- last ${w.label} (${total} decisions)`);
    for (const r of rows) {
      const share = total > 0 ? ((r.c / total) * 100).toFixed(1) : "0";
      console.log(
        `  ${r.action.padEnd(14)}${pad(r.c, 7)}${pad(share + "%", 9)}`,
      );
    }
  }

  console.log("\nmost recent decisions:");
  for (const r of all<{ decided_at: string; action: string; reason: string }>(
    `SELECT decided_at, action, substr(reason,1,90) reason FROM daemon_decisions
		 ORDER BY id DESC LIMIT 12`,
  )) {
    console.log(`  ${r.decided_at}  ${r.action.padEnd(12)} ${r.reason}`);
  }
});

// -------------------------------------------------------- per-cycle enrichment
hr("ENRICH CYCLES (job_runs detail_json)");
safe("enrich cycles", () => {
  console.log(
    "id        started_at            sec   enriched  requests  concurrency",
  );
  for (const r of all<{
    id: number;
    started_at: string;
    sec: number;
    detail_json: string;
  }>(
    `SELECT id, started_at,
		        ROUND((julianday(COALESCE(finished_at,'now')) - julianday(started_at)) * 86400, 1) sec,
		        detail_json
		 FROM job_runs WHERE job_type = 'enrich' ORDER BY id DESC LIMIT 25`,
  )) {
    let d: Record<string, unknown> = {};
    try {
      d = JSON.parse(r.detail_json) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    console.log(
      `${pad(r.id, 8)}  ${r.started_at}${pad(r.sec, 7)}${pad(d.enriched ?? "-", 10)}` +
        `${pad(d.requests ?? "-", 10)}${pad(d.concurrency ?? "-", 13)}`,
    );
  }
});

// ----------------------------------------------------------------- stage times
hr("STAGE TIMINGS (enrichment_metrics, single row = last cycle)");
safe("enrichment_metrics", () => {
  const m = one<Record<string, unknown>>(
    "SELECT * FROM enrichment_metrics WHERE id = 1",
  );
  if (m) {
    for (const k of [
      "cycle_started_at",
      "cycle_finished_at",
      "enriched_fast",
      "enriched_deep",
      "failed",
      "requests",
      "concurrency",
      "throughput_per_min",
      "quota_remaining",
      "quota_reset_at",
      "avg_metadata_ms",
      "avg_classification_ms",
      "avg_readme_ms",
      "avg_story_ms",
      "avg_db_write_ms",
      "avg_total_ms",
      "avg_latency_ms",
      "updated_at",
    ]) {
      console.log(`  ${k.padEnd(24)}${String(m[k])}`);
    }
    console.log(
      "\n  rolling percentiles (process-local sample, resets on restart):",
    );
    try {
      console.log(
        "  " + JSON.stringify(JSON.parse(String(m.stage_percentiles_json))),
      );
    } catch {
      console.log("  (unparseable)");
    }
  }
});

// -------------------------------------------------------- failures + responses
hr("HTTP STATUS / ATTEMPTS / FAILURES");
safe("http status", () => {
  console.log("last_enrichment_http_status distribution:");
  for (const r of all<{ s: string; c: number }>(
    `SELECT COALESCE(CAST(last_enrichment_http_status AS TEXT),'(null)') s, COUNT(*) c
		 FROM repos GROUP BY s ORDER BY c DESC LIMIT 12`,
  )) {
    console.log(`  ${r.s.padEnd(10)}${pad(r.c)}`);
  }
});

safe("attempts", () => {
  console.log("\nenrichment_attempts histogram (unenriched):");
  for (const r of all<{ a: number; c: number }>(
    `SELECT enrichment_attempts a, COUNT(*) c FROM repos
		  WHERE enriched_at IS NULL AND deleted_at IS NULL
		  GROUP BY a ORDER BY a LIMIT 12`,
  )) {
    console.log(`  ${pad(r.a, 3)}${pad(r.c, 12)}`);
  }
});

safe("errors", () => {
  console.log("\ntop last_enrichment_error values:");
  for (const r of all<{ e: string; c: number }>(
    `SELECT substr(last_enrichment_error,1,70) e, COUNT(*) c FROM repos
		  WHERE last_enrichment_error IS NOT NULL
		  GROUP BY e ORDER BY c DESC LIMIT 10`,
  )) {
    console.log(`  ${pad(r.c, 8)}  ${r.e}`);
  }
});

safe("ingest freshness", () => {
  console.log("\ningest freshness:");
  console.log(
    "  " +
      JSON.stringify(
        one(
          `SELECT MAX(hour_key) latest_hour, COUNT(*) hours_ingested,
					        MAX(ingested_at) last_ingest_at FROM ingestion_state`,
        ),
      ),
  );
});

db.close();
