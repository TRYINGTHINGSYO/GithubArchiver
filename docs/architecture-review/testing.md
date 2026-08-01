# Testing and verification

## Test suite inventory

The repository contains 15 Vitest files plus two helpers, with 66 tests discovered in the local run.

| Test file | Coverage intent |
|---|---|
| `archive-outcomes.test.ts` | Saved/skipped/permanent/transient outcome classification and exhaustive fallback |
| `archive-queue.test.ts` | Select only enriched repos missing source, exclude permanent failure, FIFO order |
| `bulk-export-zip.test.ts` | Reuse per-repository ZIP snapshot in bulk export |
| `category-discovery.test.ts` | Category-to-search qualifiers and deterministic hourly rotation |
| `daemon-decisions.test.ts` | Expected rate-limit idle vs unexpected idle-with-backlog |
| `daemon-migration.test.ts` | Apply schema v11 intelligence/ops migration |
| `daemon-planner.test.ts` | Action ranking, backlog priorities, rate-limit idle, sleep/backoff behavior |
| `ingest-cycle-status.test.ts` | All-unavailable success vs genuine error failure |
| `ingestion-missing-hours.test.ts` | Publish grace, same-day 404, cooldown, missing-hour counts/planner path |
| `orphan-jobs.test.ts` | Stale running job reconciliation |
| `repo-history.test.ts` | Topic normalization/diff, idempotent history, license/topic events, `as_of` state |
| `repo-intelligence.test.ts` | Summary preference/truncation and selected category rules |
| `repo-nav.test.ts` | Detail path, card click/keyboard/propagation behavior |
| `source-browser.test.ts` | Nested file-tree construction |
| `source-zip.test.ts` | Migration v13, ZIP path/conversion/record/reuse/backfill |

The database helper creates temporary SQLite databases and runs migrations; the tar helper creates fixture archives.

## Local run result

`npm test` result on 2026-08-01:

| Metric | Result |
|---|---:|
| Test files | 15 |
| Passed files | 8 |
| Failed files | 7 |
| Tests | 66 |
| Passed tests | 44 |
| Failed tests | 22 |

All 22 failing tests in this run hit the same environment problem before meaningful database/archive assertions: host Node 22 uses module ABI 127, while the installed `better-sqlite3` native binary was compiled for ABI 115. Pure TypeScript/logic suites passed. The failing database-backed areas were source ZIP, repository history/state database cases, ingestion missing-hour database cases, archive queue, bulk export, orphan jobs, and migration.

This does not prove those 22 product behaviors are defective, and it also does not count them as verified. Reinstalling/rebuilding dependencies for Node 22 or running under the Docker/Node 20 environment is required for a valid full result.

## Build and type-check result

- `npm run build`: succeeded.
- `npx tsc --noEmit`: failed with 32 errors.

Error groups:

| Area | Errors/meaning |
|---|---|
| Worker/job result typing | Many result interfaces are passed where `Record<string, unknown>` is required |
| `archive-outcomes.ts` | Impossible union comparison involving `missing` |
| `repos.ts` | Event type string mismatch; impossible source-vs-ZIP comparison; `sourceAnalysis` narrowed to `never` |
| Snapshot/ZIP imports | `ArchiveSnapshotRow` imported from a module that does not export it |
| README comparison | Missing `renderMarkdownSafe` and `diffLines` symbols (three errors, runtime relevant) |
| Maintenance results | Doctor/storage report types not assignable to job detail record |
| Tests | Source ZIP tests pass partial objects where full `RepoRow` is required |

Vite transpiles TypeScript without a standalone type-check gate, so build success currently masks real compile-time defects. There is no `check` script or CI configuration in this source export.

## What is well tested

- Planner priority and sleep logic has extensive pure unit coverage.
- Recent GH Archive availability semantics have focused edge cases.
- Change-only topic/license history behavior is specified.
- Archive queue and outcome classification intent is explicit.
- ZIP conversion/reuse/backfill paths have integration-style fixtures.
- Repository card keyboard behavior has a small test seam.
- Deterministic classification/summary has representative unit cases.

## Major untested systems

No tests were found for:

- SvelteKit page loaders or endpoint request/response/status contracts;
- authentication/authorization (none exists), CSRF, rate limiting, security headers;
- admin destructive confirmation and concurrent action behavior;
- GitHub HTTP client error/rate-limit/rename/release/tag behavior with mocked responses;
- GH Archive streaming corruption, malformed events at scale, and all event variants;
- full enrich/refresh/archive pipeline transactionality;
- README Markdown sanitization and search-snippet XSS;
- FTS query construction, relevance, Unicode, snippets, filters, rebuild equivalence;
- repository detail evidence/score/recoverability/story projections;
- disconnected source analysis in the main detail loader;
- source parser decompression limits, path traversal, binary detection, cache eviction, malformed tarballs;
- snapshot download safe paths and memory behavior;
- backup and destructive restore end to end;
- doctor/storage cleanup correctness across shared paths and partial failures;
- backfill API validation/range behavior and autonomous resume;
- bulk export status/download endpoints and retention;
- daemon/web/manual/CLI concurrency and multi-process races;
- database migration chain from every historical version and rollback/recovery;
- UI accessibility, browser interaction, responsive visual layout, polling, or action errors;
- performance/load/soak/disk-full/quota-exhaustion behavior.

## Coverage and quality infrastructure

Absent from the repository:

- coverage collection/thresholds;
- ESLint/Prettier or another declared linter/formatter;
- Svelte type checker (`svelte-check`) script;
- Playwright/Cypress/browser tests;
- visual regression and screenshot baselines;
- property/fuzz testing;
- dependency/security scanning;
- GitHub Actions or other CI configuration in the export;
- test database fixture size/benchmark suite;
- pre-commit hooks.

## Recommended verification order

Documentation-only recommendation:

1. Establish a supported Node version contract and reinstall native dependencies; make all 66 tests execute.
2. Add `tsc`/`svelte-check` as a required build/CI gate and resolve the current 32 errors.
3. Add endpoint integration tests around the unauthenticated mutation surface before exposing it.
4. Add security tests for Markdown/snippet HTML and archive path/decompression behavior.
5. Add pipeline integration tests with mocked GitHub/GH Archive failure matrices.
6. Add migration tests from each schema version and backup/restore drills.
7. Create a production-shaped synthetic corpus for query plans, latency, memory, and disk growth.
8. Add browser/accessibility tests for public and admin critical flows.
