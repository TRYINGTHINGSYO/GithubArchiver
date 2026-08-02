# Technical debt, defects, dead paths, and risks

## Severity model

- **Critical:** unsafe public deployment, preservation loss, or systemic integrity risk.
- **High:** a core feature is broken/misleading or likely to fail under normal scale.
- **Medium:** material maintainability, correctness, performance, or operator problem.
- **Low:** cleanup, consistency, or documentation debt with limited immediate impact.

## Confirmed defects and risks

| Severity | Finding | Evidence and impact |
|---|---|---|
| Critical | No authentication/authorization | All admin, maintenance, destructive storage, archive, backup, backfill, export, job/error, and daemon endpoints are public |
| Critical | No CSRF/origin protection | Browser-triggered mutations are accepted; export creation even uses GET |
| High | Automatic source preservation is one-shot | Archive queue selects only repositories with no source snapshot, so changed source is never periodically captured |
| High | README comparison runtime failure | Valid comparison calls undefined `renderMarkdownSafe` and `diffLines`; `tsc` reports all three |
| High | Source intelligence disconnected | `getRepoWithSnapshots` hardcodes `sourceAnalysis: null`; detail security/technology evidence cannot populate |
| High | Vite build masks type failure | Production build succeeds while standalone TypeScript reports 32 errors |
| High | Synchronous heavy work shares web event loop | SQLite, storage scans, tar gunzip/parse, hashing, snapshot reads, maintenance can block all HTTP |
| High | Archive/decompression memory risk | Five 50 MiB buffered downloads plus full decompression; no decompressed-size ceiling |
| High | No durable/multi-process job ownership | In-memory daemon/queue permits duplicate work across replicas, CLI, inline actions |
| High | Destructive storage cleanup conflicts with archive promise | Evidence files/rows can be deleted without auth, mandatory backup, operator audit, or trash |
| High | Untrusted Markdown sanitization is regex-based | Public README HTML is rendered; no proven allowlist sanitizer/CSP |
| Medium | FTS snippet rendered with `{@html}` | Component boundary trusts SQLite snippet; no XSS regression tests |
| Medium | Initial metric baseline missing | Enrich writes current metrics but no snapshot; deltas need later refresh observations |
| Medium | Releases/assets become stale | Existing release rows and asset download counts are not refreshed |
| Medium | Optional upstream errors look like missing evidence | Release/tag/README/history helpers swallow some errors, including quota/network cases |
| Medium | Orphan job threshold can misclassify live work | Any `running` job older than ten minutes can be failed without heartbeat/host ownership |
| Medium | Admin maintenance busy check is incomplete | It checks manual queue state but runs inline and does not lock against daemon/CLI/other requests |
| Medium | Database/filesystem writes are not atomic | Crash can create missing rows/files or orphan files; doctor only detects selected drift |
| Medium | Unbounded history and cache growth | Metrics/events/jobs/decisions/search stats/exports/logs and source caches lack retention |
| Medium | N+1 repository projection | Per-card archive badge and ZIP URL queries add substantial query count |
| Medium | Weak request/config validation | `NaN`, negative limits, invalid dates/ranges/hours and enum-like text are inconsistently rejected |
| Medium | Category gap logic misses zero-count categories | Rollup inserts only categories present, so absence cannot be identified as underrepresented |
| Medium | Classifier file rules are inactive | Normal caller omits file paths despite rule support |
| Medium | Historical state API overpromises if read broadly | `as_of` resolves only a subset of repository state |
| Medium | Local launcher can kill unrelated process | Stop script force-terminates every listener on port 5173 |
| Low | Sitemap omits repository pages | Only home and birth feed are published to crawlers |
| Low | Version/schema documentation drift | README v9 vs schema v13; package 0.1 vs user-agent 0.3 |
| Low | `.env.example` defaults drift | Archive worker/burst source defaults differ from documented sample |

## Type-check debt

The 32 errors are not purely cosmetic. They fall into these remediation groups:

1. **Runtime-symbol defect:** missing compare-README imports/definitions.
2. **Incorrect narrowing/impossible comparisons:** archive outcomes, source-vs-ZIP checks, null source analysis.
3. **Domain type boundary:** repository event type returned as generic string.
4. **Wrong export boundary:** snapshot row type imported from a module that only imports it internally.
5. **Job detail typing:** typed result objects lack a string index signature expected by generic JSON detail APIs.
6. **Test fixtures:** partial repository objects passed to functions requiring full rows.

There is no script or CI gate to prevent additional errors.

## Explicit markers found

Repository-wide scan found no active `TODO`, `FIXME`, `HACK`, `XXX`, or `NOTE` markers in source. The `XXX` substring occurs only coincidentally inside one lockfile integrity hash. That does not imply no debt; most debt is unmarked.

Explicit compatibility/deprecation markers:

- `src/lib/server/db/connection.ts`: exported `DB_PATH` is marked deprecated in favor of `getDatabasePath()` because the latter resolves environment state at call time.
- `src/lib/server/db/repo-query.ts`: legacy feed mapping/filter branches remain.
- `scripts/lib/inspect-hour.ts`: legacy GH Archive matcher measurement remains for comparison.
- `src/lib/server/worker-control.ts`: `runPipelineNow` and `runWorkerJob` are described/structured as legacy process-spawn controls and have no active route imports.
- Source ZIP tests explicitly cover legacy tarball backfill; this is intentional compatibility, not dead code.
- `package-lock.json` records transitive `prebuild-install@7.1.3` as deprecated/no longer maintained.

## Dead, unreachable, and apparently unused code

### Confirmed unreachable UI

`src/routes/admin/status/+page.server.ts` always redirects to `/admin`, while `src/routes/admin/status/+page.svelte` is a 712-line old dashboard still compiled into generated client/server output. Its server and client bundles are about 24 KiB each before shared assets. It duplicates the current admin surface.

### Apparently unused exports/imports

Static import/reference inspection indicates:

- `parseBirthFeedParams` is exported from `src/lib/server/birth-feed.ts` but routes use `parseRepoQueryParams`.
- `runPipelineNow` and `runWorkerJob` are exported from `worker-control.ts` but not used by active routes.
- Bulk-export status imports `readFileSync` but does not use it.
- Repository files endpoint imports `readSourceFileFromSnapshot` and `languageClassForPath` but only uses analysis/tree helpers.
- Old CSS selectors such as `.repo-dates` / `.repo-time.muted` have no evident current markup references.

These are based on static repository references, not a whole-program tree-shaker report. Dynamic imports do not appear to explain them.

### Tables, reusable components, routes, and APIs

- No unused application-managed table was identified; each has a query/write reference. FTS internal tables and `sqlite_sequence` are SQLite-owned.
- Both reusable components are used: `RepoListItem` on Home and `FileBrowser` on repository detail.
- `/admin/status` is the one confirmed unused/unreachable page implementation because its loader redirects before the component renders.
- No endpoint can be proven unused externally. Several have no in-repository fetch caller (`/api/admin/status`, daemon decisions, repository state/timeline), because page loaders call the same server functions directly; they remain reachable public APIs and may have external consumers.

## Duplicated systems

- Autonomous in-process planner vs legacy external linear daemon.
- Current admin page vs unreachable old admin status page.
- Worker-created job rows vs daemon/pipeline parent and child job rows.
- Current repository fields vs history and event dual records without one consistent transactional abstraction.
- Source tarball plus generated ZIP plus bulk export copies plus optional full backup copies.
- Route-level repository filtering aliases/legacy feed semantics that overlap sort modes.

## Data model debt

- Enum-like text fields have no CHECK constraints.
- JSON fields are unchecked and schema-less.
- `repos.first_seen_at` has duplicate indexes.
- Releases/events/aliases use no-action FKs while other history cascades.
- No unique constraint protects repeated archive hash/head observations or event id.
- No parent job relation, artifact relation, worker lease, or operator identity.
- No history for summary/category/current homepage or most GitHub metadata.
- No URL/website/dependency/fork model.
- No retention/partition/downsampling strategy.
- Migration v1 compatibility can drop malformed legacy tables, requiring backup-focused upgrade tests.

## Security debt

- Admin and export authorization is now centralized, but job/audit rows still do not record the acting user.
- No CSP or comprehensive security-header policy; deployment still relies on trusted Host forwarding. Auth.js supplies HTTP-only, SameSite session cookies.
- Regex Markdown sanitization and trusted FTS HTML.
- Remote README images/links can track or deceive users.
- Archive ingestion/parser threat model is undocumented; compressed expansion and malicious filenames require deeper tests.
- Raw job errors/details may disclose paths or upstream information.
- GitHub token is a process environment secret without scoped validation/redaction/rotation workflow.
- Docker runs as root and includes compiler toolchain/dev dependencies in the final single-stage image.

## Operational debt

- No durable scheduler/queue, cancellation, heartbeat, per-host ownership, or multi-replica safety.
- No metrics/traces/alerts, SLOs, or capacity planning.
- No backup schedule, retention, offsite copy, encryption, or automated restore proof.
- No disk-full guard before archive/export/full backup.
- No log/export/job/decision retention.
- No migration rollback strategy.
- No production Node version declaration outside Docker.
- No CI files in the export and no automated dependency/security checks.

## Documentation debt

- README describes schema v9, old `/admin/status` entry points, and an earlier feature set.
- Roadmap and metrics specifications are aspirational but can be mistaken for implemented APIs.
- Environment variables used by critical/destructive behavior are missing from `.env.example`.
- Archive retention and append-only claims do not explain cleanup deletion.
- No API reference existed before this snapshot.
- No data privacy policy covers commit author names/emails, repository content, or deleted projects.

## Priority order

Documentation-only recommendation:

1. Secure the admin/mutation surface and correct unsafe GET mutations.
2. Make type checking mandatory; fix the README comparison and source-analysis disconnect.
3. Correct automated archive recapture semantics with explicit retention/capacity policy.
4. Isolate heavy jobs and introduce durable single-owner work leases.
5. Establish artifact/database transaction recovery, backup/restore verification, and disk guards.
6. Instrument performance and upstream quota before scaling.
7. Consolidate duplicated daemons/admin UI/job records and remove dead code after compatibility decisions.
8. Version and audit intelligence derivations before adding richer models.
