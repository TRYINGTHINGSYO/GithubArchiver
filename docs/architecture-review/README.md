# GithubArchive+ architecture review

- Snapshot date: 2026-08-01
- Reviewed source: the exported workspace at `GithubArchiver-main`
- Application version: `0.1.0`
- Executable database schema: v13

This directory is the documentation-only engineering snapshot requested for GithubArchive+. It describes the repository as it exists, including incomplete, broken, risky, generated, and planned behavior. No application code, schema, data, or configuration was changed as part of this review.

## Reading order

1. [Product and system overview](./overview.md)
2. [Architecture and runtime topology](./architecture.md)
3. [Repository structure and complete tree](./repository-structure.md)
4. [Database and migrations](./database.md)
5. [Pages, routes, and UI](./routes-and-ui.md)
6. [HTTP API reference](./api.md)
7. [Workers, jobs, and pipelines](./workers-and-jobs.md)
8. [Intelligence, evidence, classification, and scoring](./intelligence.md)
9. [Website discovery and missing product systems](./website-discovery.md)
10. [Search and discovery](./search.md)
11. [Administration and operations](./admin-and-operations.md)
12. [Performance and scalability](./performance.md)
13. [Testing and verification](./testing.md)
14. [Configuration and deployment](./configuration.md)
15. [Dependencies](./dependencies.md)
16. [Technical debt, deprecated paths, and known defects](./technical-debt.md)
17. [Product review and future roadmap](./product-review-and-roadmap.md)

## Requested-part coverage

| Request part | Primary document(s) |
|---:|---|
| 1 Product overview | `overview.md`, `technical-debt.md` |
| 2 Architecture | `architecture.md`, plus subsystem documents |
| 3 Repository structure | `repository-structure.md` |
| 4 Database | `database.md` |
| 5 Routes | `routes-and-ui.md` |
| 6 API | `api.md` |
| 7 UI | `routes-and-ui.md` |
| 8 Components | `routes-and-ui.md` component inventory |
| 9 Jobs | `workers-and-jobs.md` |
| 10 Intelligence | `intelligence.md` |
| 11 Website discovery | `website-discovery.md` |
| 12 Search | `search.md` |
| 13 Admin | `admin-and-operations.md` |
| 14 Performance | `performance.md` |
| 15 Testing | `testing.md` |
| 16 Configuration | `configuration.md` |
| 17 Dependencies | `dependencies.md` |
| 18 TODO/dead/deprecated/unused | `technical-debt.md` |
| 19 Product review | `product-review-and-roadmap.md` |
| 20 Deliverables | This directory and index |

## Evidence rules used in this snapshot

- **Implemented** means there is an active code path, route, schema object, or deployed configuration in this repository.
- **Partially implemented** means a visible feature exists but an important input, output, lifecycle stage, or integration is absent or disconnected.
- **Planned** means it appears only in `docs/ROADMAP.md`, `docs/METRICS.md`, or `docs/PROPOSAL-autonomous-intelligence.md` and is not an active implementation.
- **Absent** means repository-wide inspection found no corresponding table, route, component, worker, configuration, or test.
- **Measured locally** means the number came from this workspace on 2026-08-01. The checked-in database is an empty fixture, not production data.
- **Estimated** means an engineering projection from row cardinality, query shape, data type, or configured limits. It is not production telemetry.

## Review method and limitations

The review covered all files except directories explicitly excluded by the request: `node_modules`, `build`, `dist`, `coverage`, `cache`, and `.tmp`. It included generated `.svelte-kit` output and the local `data` directory. The source export has no `.git` directory, so commit history, branch state, ignored/untracked status, authorship, and historical code ownership cannot be recovered from this workspace.

Validation performed:

- repository-wide source, route, schema, environment-variable, dependency, marker, and test inventory;
- direct read-only SQLite schema and population inspection;
- `npm run build`;
- `npx tsc --noEmit`;
- `npm test`;
- generated client/server artifact sizing.

The UI could not be run against SQLite in the current host because Node 22 expects native-module ABI 127 while the installed `better-sqlite3` binary was built for ABI 115 (Node 20). Consequently there are no new runtime screenshots. No screenshot assets exist in the repository; only `static/favicon.svg` is present. The production Docker image intentionally uses Node 20, which matches the installed native binary family more closely, but the image itself was not deployed during this documentation task.

## Highest-impact findings

These are entry points into the detailed evidence, not a replacement for it.

1. Every page and endpoint, including destructive administration, archive creation, maintenance repair, storage deletion, backup, and bulk export, is unauthenticated. There is no authorization, session, CSRF, or role model.
2. The architectural core is a single SvelteKit Node process using synchronous SQLite and filesystem access. The background daemon, manual job queue, SSR, API, analysis, and downloads compete for the same event loop and memory.
3. The source export builds with Vite, but the independent TypeScript check reports 32 errors. The README comparison page references three missing symbols and can fail at runtime.
4. `getRepoWithSnapshots` always returns `sourceAnalysis: null`. The detail page's source-derived security and technology intelligence is therefore disconnected even though source analysis APIs exist.
5. Automated archive selection stops considering a repository once it has any source snapshot. Changed repositories are not periodically source-archived by the daemon; only manual/export paths can capture later source states.
6. The checked-in database is schema v13 and empty. README documentation still says schema v9. Production row counts, latency, database growth, archive size, and query percentiles are not available in this export.
7. Website discovery is limited to GitHub's `homepage` metadata and README link/image extraction. Website crawling, verification, screenshots, dead-site detection, ratings, favorites, collections, random discovery, and moderation are absent.
8. Categories, deterministic summaries, evidence references, preservation scoring, recoverability, and simple related-project ranking exist. Clusters, calibrated confidence, duplicate-repository detection, embeddings, dependencies, human review, and an LLM pipeline do not.
