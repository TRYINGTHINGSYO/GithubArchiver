# Recommended PR sequence

Based on review of `2b77ed9` (PR #28 head). Prefer narrow PRs. Do **not** combine security, architecture isolation, and major UI redesign.

Assumes PR #28 (website curation) merges or remains the integration base. PR #30 empty-state fix is on `main` and should be merged/backported deliberately.

---

## PR A — Security and destructive mutation protection

| Field | Content |
|---|---|
| Objective | Close ungated mutations, add Origin/CSRF, harden admin secrets, stop GET mutations |
| Fix packets | `01` |
| Why this order | Prevents data loss/exfil before investing in deeper correctness work |
| Migration risk | Low (optional additive `mutation_audit`) |
| Expected files | `auth.ts`, `hooks.server.ts`, export/emerging/repo-save routes, logout, login, tests, env docs |
| Required tests | 401/403 gating; Origin rejection; GET bulk export no longer starts jobs; anonymous curation still works; prod secret fail-closed |
| Smoke-test routes | `/login`, `/admin/storage`, `POST /api/admin/workers`, `/api/export/bulk`, `/websites/random` favorite/rating |
| Rollback | Revert PR; restore previous public mutation behavior (undesirable but simple) |
| Explicit exclusions | Worker split, cluster wipe UI, sourceAnalysis wiring, search redesign |

---

## PR B — Build / TypeScript / runtime correctness

| Field | Content |
|---|---|
| Objective | Make `tsc --noEmit` pass; fix compare-readme imports; CI typecheck |
| Fix packets | `02` (partial overlap with `04` typing only) |
| Why this order | Unblocks safe refactors and prevents shipping known runtime ReferenceError |
| Migration risk | None |
| Expected files | `compare-readme/+page.server.ts`, job/worker type signatures, archive type exports, CI workflow |
| Required tests | Compare-readme load test; `tsc --noEmit` in CI; full `npm test` |
| Smoke-test routes | `/repo/{owner}/{repo}/compare-readme?from=&to=` |
| Rollback | Revert; compare page remains broken |
| Explicit exclusions | Full sourceAnalysis feature wiring (PR D), auth (PR A) |

---

## PR C — Empty-state and stale intelligence correctness

| Field | Content |
|---|---|
| Objective | Never show growth cluster cards without live memberships; purge stale materialization |
| Fix packets | `03` |
| Why this order | Correctness of intelligence UX; fix already exists as `2c5b89f` / PR #30 |
| Migration risk | None (runtime purge) |
| Expected files | discovery materialization + homepage/discover empty states + TTL clear + `tests/cluster-wipe-empty-state.test.ts` |
| Required tests | Fresh DB; repos without memberships; stale materialization purge; TTL reopen |
| Smoke-test routes | `/`, `/discover`, `/discover/fastest-growing` on empty DB |
| Rollback | Revert cherry-pick |
| Explicit exclusions | Taxonomy redesign, security, archive refresh |

**Integration note:** If PR #28 is not yet on `main`, either merge `main` (with PR #30) into the release branch or cherry-pick `2c5b89f` after PR #28.

---

## PR D — Source analysis detail wiring

| Field | Content |
|---|---|
| Objective | Populate or explicitly defer `sourceAnalysis` on repo detail instead of hard-coded null |
| Fix packets | `04` |
| Why this order | Depends on stable types from PR B; user-visible intelligence gap |
| Migration risk | Low if additive analysis cache |
| Expected files | `repos.ts`, source-archive helpers, detail page server load, tests |
| Required tests | With/without source snapshot; reanalyze path |
| Smoke-test routes | `/repo/{owner}/{repo}` with archived source |
| Rollback | Revert to lazy client-only fetch |
| Explicit exclusions | Recurring archive refresh (PR E), UI redesign |

---

## PR E — Archive refresh correctness

| Field | Content |
|---|---|
| Objective | Re-archive when remote HEAD differs from latest source snapshot |
| Fix packets | `05` |
| Why this order | Preservation correctness after detail analysis can show current snapshots |
| Migration risk | Low; increases archive volume — watch retention |
| Expected files | `listEnrichedReposForArchive`, archiver skip-same-head, archive-queue tests |
| Required tests | head changed / unchanged / first-time / permanent failure |
| Smoke-test routes | Admin archive worker; repo detail snapshots list |
| Rollback | Restore one-shot `NOT EXISTS` predicate |
| Explicit exclusions | Storage redesign, process isolation |

---

## PR F — Worker / process reliability

| Field | Content |
|---|---|
| Objective | Ensure heavy jobs run in daemon process with single-owner lease; web enqueues only |
| Fix packets | `06` (optionally start `07` bounds if small) |
| Why this order | After correctness fixes; reduces production latency risk |
| Migration risk | Low–medium (lease columns) |
| Expected files | hooks, background-daemon, job-runner, start-production, jobs schema |
| Required tests | BACKGROUND_WORKER=0; lease winner; enqueue-only admin actions |
| Smoke-test routes | `/api/health`, `/admin/jobs`, daemon status |
| Rollback | Env flag to allow inline execution |
| Explicit exclusions | Postgres migration, auth, UI redesign |

---

## PR G — SQLite bounds + website curation hardening

| Field | Content |
|---|---|
| Objective | Bound expensive queries; rate-limit/moderate website curation abuse |
| Fix packets | `07`, `08` |
| Why this order | Reliability after process topology is clear; curation already shipped in PR #28 |
| Migration risk | Low (indexes + optional moderation columns) |
| Expected files | storage/doctor limits, website rating rate limits, admin moderate API |
| Required tests | Limit enforcement; rate limit; moderation; index migration |
| Smoke-test routes | `/admin/storage`, `/websites/{domain}`, `/websites/random` |
| Rollback | Revert limits/columns |
| Explicit exclusions | Screenshots, accounts, semantic search |

---

## PR H — Intelligence quality

| Field | Content |
|---|---|
| Objective | Honest confidence labeling, classifier versioning, stronger overrides |
| Fix packets | `09` |
| Why this order | Product quality after security/correctness/reliability |
| Migration risk | Low |
| Expected files | classify-repo, intelligence UI, audit scripts |
| Required tests | Override preference; confidence kind; audit script smoke |
| Smoke-test routes | `/admin/intelligence`, repo detail category display |
| Rollback | Revert copy/version fields |
| Explicit exclusions | Embeddings, LLM pipeline |

---

## PR I — Search and discovery follow-up

| Field | Content |
|---|---|
| Objective | Safe snippets + query bounds; document non-semantic search |
| Fix packets | `10` |
| Why this order | Hardening/product polish last among listed packets |
| Migration risk | None |
| Expected files | search API, RepoCard/RepoListItem snippet rendering, XSS tests |
| Required tests | XSS regression; query limits |
| Smoke-test routes | `/search?q=` |
| Rollback | Revert rendering |
| Explicit exclusions | Vector search, website crawl index |

---

## Sequence diagram

```text
A security → B tsc/runtime → C empty clusters → D sourceAnalysis
        → E archive refresh → F workers → G sqlite+websites → H intel quality → I search
```

## Prefer not to do

- One mega-PR with auth + worker split + UI shell changes
- Mixing P3 website screenshots into P0 security
- Re-documenting the entire v13 export as if it were current
