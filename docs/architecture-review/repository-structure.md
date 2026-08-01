# Repository structure

## Scope

This tree was generated after the documentation snapshot on 2026-08-01. Per the request, only directories named `node_modules`, `build`, `dist`, `coverage`, `cache`, and `.tmp` are excluded. Generated `.svelte-kit` output and local `data` files are included. The export contains no `.git` directory.

## Major directories and files

| Path | Purpose |
|---|---|
| `.svelte-kit/` | Generated SvelteKit types, route nodes, optimized client/server output, manifests, and Node adapter helpers; disposable build state, not hand-authored source |
| `data/` | Local SQLite/WAL/SHM, process logs, and generated bulk export; production Docker redirects this class to `/data` |
| `docs/` | Product roadmap, metrics/proposal/restore/local-operation documents, migration reference, and this architecture review |
| `scripts/` | TypeScript CLI entry points for ingest, enrichment, archive, backfill, database init, backup/restore, diagnosis, storage, and legacy daemon |
| `scripts/lib/` | Shared ingest core and hour inspection implementation used by CLI and aliased server imports |
| `src/lib/components/` | The two reusable Svelte components: repository list item and source file browser |
| `src/lib/server/db/` | SQLite connection, migrations, row types, and table-specific repository/query functions |
| `src/lib/server/workers/` | Bounded worker-cycle implementations |
| `src/lib/server/` | External API clients, orchestration, enrichment/archive/intelligence, maintenance, projection, storage/export/backup logic |
| `src/routes/` | SvelteKit page routes and endpoint routes |
| `static/` | Public static favicon |
| `tests/` | Vitest unit/integration tests and database/tar helpers |
| `.env.example` | Common environment settings; incomplete relative to all variables used in source |
| `Dockerfile`, `railway.toml` | Node 20 container and Railway deployment configuration |
| `package.json`, `package-lock.json` | Package scripts and locked dependency graph |
| `svelte.config.js`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` | Framework/build/test/type configuration |
| `start-githubarchive.bat`, `stop-githubarchive.bat` | Windows development launcher/port-based force stop |

## Complete tree

```text
GithubArchiver-main
├── .svelte-kit
│   ├── adapter-node
│   │   └── entries
│   │       ├── chunks
│   │       │   └── vendor.js
│   │       ├── env.js
│   │       ├── handler.js
│   │       ├── index.js
│   │       ├── shims.js
│   │       └── utils.js
│   ├── generated
│   │   ├── client
│   │   │   ├── nodes
│   │   │   │   ├── 0.js
│   │   │   │   ├── 1.js
│   │   │   │   ├── 10.js
│   │   │   │   ├── 11.js
│   │   │   │   ├── 12.js
│   │   │   │   ├── 2.js
│   │   │   │   ├── 3.js
│   │   │   │   ├── 4.js
│   │   │   │   ├── 5.js
│   │   │   │   ├── 6.js
│   │   │   │   ├── 7.js
│   │   │   │   ├── 8.js
│   │   │   │   └── 9.js
│   │   │   ├── app.js
│   │   │   └── matchers.js
│   │   ├── client-optimized
│   │   │   ├── nodes
│   │   │   │   ├── 0.js
│   │   │   │   ├── 1.js
│   │   │   │   ├── 10.js
│   │   │   │   ├── 11.js
│   │   │   │   ├── 12.js
│   │   │   │   ├── 2.js
│   │   │   │   ├── 3.js
│   │   │   │   ├── 4.js
│   │   │   │   ├── 5.js
│   │   │   │   ├── 6.js
│   │   │   │   ├── 7.js
│   │   │   │   ├── 8.js
│   │   │   │   └── 9.js
│   │   │   ├── app.js
│   │   │   └── matchers.js
│   │   ├── server
│   │   │   └── internal.js
│   │   ├── shared
│   │   │   └── error-template.js
│   │   ├── root.js
│   │   └── root.svelte
│   ├── output
│   │   ├── client
│   │   │   ├── .vite
│   │   │   │   └── manifest.json
│   │   │   ├── _app
│   │   │   │   ├── immutable
│   │   │   │   │   ├── assets
│   │   │   │   │   │   ├── 0.pEJvyQ_5.css
│   │   │   │   │   │   ├── 10.BQXMKyLh.css
│   │   │   │   │   │   ├── 11.CGN2PpLN.css
│   │   │   │   │   │   ├── 2.DNiCUWnh.css
│   │   │   │   │   │   ├── 3.D6f3TI6n.css
│   │   │   │   │   │   ├── 4.Dj-1q5u0.css
│   │   │   │   │   │   ├── 5.DUzBqSzt.css
│   │   │   │   │   │   ├── 6.Bs9j4hxh.css
│   │   │   │   │   │   ├── 7.BdHbCw9q.css
│   │   │   │   │   │   ├── 8.D_cnk109.css
│   │   │   │   │   │   └── 9.C1Km4now.css
│   │   │   │   │   ├── chunks
│   │   │   │   │   │   ├── -ktMJ4k_.js
│   │   │   │   │   │   ├── -SiE2qry.js
│   │   │   │   │   │   ├── 1r-oCAAW.js
│   │   │   │   │   │   ├── 1XMeFRUB.js
│   │   │   │   │   │   ├── B5GAA4Sp.js
│   │   │   │   │   │   ├── B6r1r-bu.js
│   │   │   │   │   │   ├── BJOVlRNt.js
│   │   │   │   │   │   ├── Bk9c8qHq.js
│   │   │   │   │   │   ├── BLuYMIDp.js
│   │   │   │   │   │   ├── C0bjXBm6.js
│   │   │   │   │   │   ├── CjAw6_qK.js
│   │   │   │   │   │   ├── CR0hAoK5.js
│   │   │   │   │   │   ├── CVFPFRyP.js
│   │   │   │   │   │   ├── D526VhIC.js
│   │   │   │   │   │   ├── DCptqqLu.js
│   │   │   │   │   │   ├── DkLr0qb_.js
│   │   │   │   │   │   ├── DTCF0BQW.js
│   │   │   │   │   │   ├── i8MhsCjT.js
│   │   │   │   │   │   ├── JN4_8OM5.js
│   │   │   │   │   │   ├── s-r1UsXA.js
│   │   │   │   │   │   ├── SViw_xbR.js
│   │   │   │   │   │   └── wbPk3Yxo.js
│   │   │   │   │   ├── entry
│   │   │   │   │   │   ├── app.TjhlCeRo.js
│   │   │   │   │   │   └── start.CNFCDNwb.js
│   │   │   │   │   └── nodes
│   │   │   │   │       ├── 0.OIXHiup3.js
│   │   │   │   │       ├── 1.BMHhLLeo.js
│   │   │   │   │       ├── 10.BL6oOzAw.js
│   │   │   │   │       ├── 11.Byoljt1n.js
│   │   │   │   │       ├── 12.Bly475iA.js
│   │   │   │   │       ├── 2.BvIuBlbU.js
│   │   │   │   │       ├── 3.C995MnQK.js
│   │   │   │   │       ├── 4.BKmvNRp0.js
│   │   │   │   │       ├── 5.D-hDo47t.js
│   │   │   │   │       ├── 6.CBqht4uG.js
│   │   │   │   │       ├── 7.BhIATrsA.js
│   │   │   │   │       ├── 8.DNh1ar34.js
│   │   │   │   │       └── 9.DpIu6X2l.js
│   │   │   │   └── version.json
│   │   │   └── favicon.svg
│   │   └── server
│   │       ├── .vite
│   │       │   └── manifest.json
│   │       ├── _app
│   │       │   └── immutable
│   │       │       └── assets
│   │       │           ├── _layout.Bve0VIBd.css
│   │       │           ├── _layout.DNiCUWnh.css
│   │       │           ├── _page.BdHbCw9q.css
│   │       │           ├── _page.Bs9j4hxh.css
│   │       │           ├── _page.C1Km4now.css
│   │       │           ├── _page.CGN2PpLN.css
│   │       │           ├── _page.D_cnk109.css
│   │       │           ├── _page.D6f3TI6n.css
│   │       │           ├── _page.DUzBqSzt.css
│   │       │           ├── _page.mVpjBcKW.css
│   │       │           └── _page.w21BAsXM.css
│   │       ├── chunks
│   │       │   ├── admin.js
│   │       │   ├── archive.js
│   │       │   ├── archiver.js
│   │       │   ├── background-daemon.js
│   │       │   ├── birth-feed.js
│   │       │   ├── birth-feed2.js
│   │       │   ├── bulk-export.js
│   │       │   ├── client.js
│   │       │   ├── connection.js
│   │       │   ├── daemon-decisions.js
│   │       │   ├── doctor.js
│   │       │   ├── events.js
│   │       │   ├── exports.js
│   │       │   ├── false.js
│   │       │   ├── html.js
│   │       │   ├── index.js
│   │       │   ├── index2.js
│   │       │   ├── ingestion.js
│   │       │   ├── intelligence.js
│   │       │   ├── internal.js
│   │       │   ├── job-runner.js
│   │       │   ├── jobs.js
│   │       │   ├── refresh.js
│   │       │   ├── releases.js
│   │       │   ├── repo-nav.js
│   │       │   ├── repo-search.js
│   │       │   ├── repos.js
│   │       │   ├── repos2.js
│   │       │   ├── root.js
│   │       │   ├── server.js
│   │       │   ├── snapshots.js
│   │       │   ├── source-archive.js
│   │       │   ├── source-browser.js
│   │       │   ├── source-zip.js
│   │       │   ├── state.svelte.js
│   │       │   ├── storage.js
│   │       │   ├── topics-normalize.js
│   │       │   ├── utils.js
│   │       │   ├── utils2.js
│   │       │   ├── utils3.js
│   │       │   ├── worker-control.js
│   │       │   └── zip-stream.js
│   │       ├── entries
│   │       │   ├── endpoints
│   │       │   │   ├── api
│   │       │   │   │   ├── admin
│   │       │   │   │   │   ├── backfill
│   │       │   │   │   │   │   └── _server.ts.js
│   │       │   │   │   │   ├── daemon
│   │       │   │   │   │   │   ├── decisions
│   │       │   │   │   │   │   │   └── _server.ts.js
│   │       │   │   │   │   │   └── _server.ts.js
│   │       │   │   │   │   ├── jobs
│   │       │   │   │   │   │   └── _server.ts.js
│   │       │   │   │   │   ├── maintenance
│   │       │   │   │   │   │   └── _server.ts.js
│   │       │   │   │   │   ├── status
│   │       │   │   │   │   │   └── _server.ts.js
│   │       │   │   │   │   └── workers
│   │       │   │   │   │       └── _server.ts.js
│   │       │   │   │   ├── birth-feed
│   │       │   │   │   │   └── _server.ts.js
│   │       │   │   │   ├── events
│   │       │   │   │   │   └── _server.ts.js
│   │       │   │   │   ├── export
│   │       │   │   │   │   └── bulk
│   │       │   │   │   │       ├── _jobId_
│   │       │   │   │   │       │   ├── download
│   │       │   │   │   │       │   │   └── _server.ts.js
│   │       │   │   │   │       │   └── _server.ts.js
│   │       │   │   │   │       └── _server.ts.js
│   │       │   │   │   ├── releases
│   │       │   │   │   │   └── latest
│   │       │   │   │   │       └── _server.ts.js
│   │       │   │   │   ├── repo
│   │       │   │   │   │   └── _owner_
│   │       │   │   │   │       └── _repo_
│   │       │   │   │   │           ├── actions
│   │       │   │   │   │           │   └── _server.ts.js
│   │       │   │   │   │           ├── export
│   │       │   │   │   │           │   └── _server.ts.js
│   │       │   │   │   │           ├── files
│   │       │   │   │   │           │   ├── content
│   │       │   │   │   │           │   │   └── _server.ts.js
│   │       │   │   │   │           │   └── _server.ts.js
│   │       │   │   │   │           ├── state
│   │       │   │   │   │           │   └── _server.ts.js
│   │       │   │   │   │           └── timeline
│   │       │   │   │   │               └── _server.ts.js
│   │       │   │   │   ├── repos
│   │       │   │   │   │   └── _server.ts.js
│   │       │   │   │   ├── search
│   │       │   │   │   │   └── _server.ts.js
│   │       │   │   │   ├── snapshots
│   │       │   │   │   │   └── _id_
│   │       │   │   │   │       └── _server.ts.js
│   │       │   │   │   └── trends
│   │       │   │   │       └── _server.ts.js
│   │       │   │   ├── robots.txt
│   │       │   │   │   └── _server.ts.js
│   │       │   │   └── sitemap.xml
│   │       │   │       └── _server.ts.js
│   │       │   ├── fallbacks
│   │       │   │   └── error.svelte.js
│   │       │   ├── pages
│   │       │   │   ├── admin
│   │       │   │   │   ├── doctor
│   │       │   │   │   │   ├── _page.server.ts.js
│   │       │   │   │   │   └── _page.svelte.js
│   │       │   │   │   ├── jobs
│   │       │   │   │   │   ├── _page.server.ts.js
│   │       │   │   │   │   └── _page.svelte.js
│   │       │   │   │   ├── status
│   │       │   │   │   │   ├── _page.server.ts.js
│   │       │   │   │   │   └── _page.svelte.js
│   │       │   │   │   ├── storage
│   │       │   │   │   │   ├── _page.server.ts.js
│   │       │   │   │   │   └── _page.svelte.js
│   │       │   │   │   ├── _layout.svelte.js
│   │       │   │   │   ├── _page.server.ts.js
│   │       │   │   │   └── _page.svelte.js
│   │       │   │   ├── birth-feed
│   │       │   │   │   ├── _page.server.ts.js
│   │       │   │   │   └── _page.svelte.js
│   │       │   │   ├── repo
│   │       │   │   │   └── _owner_
│   │       │   │   │       └── _repo_
│   │       │   │   │           ├── compare-readme
│   │       │   │   │           │   ├── _page.server.ts.js
│   │       │   │   │           │   └── _page.svelte.js
│   │       │   │   │           ├── timeline
│   │       │   │   │           │   ├── _page.server.ts.js
│   │       │   │   │           │   └── _page.svelte.js
│   │       │   │   │           ├── _page.server.ts.js
│   │       │   │   │           └── _page.svelte.js
│   │       │   │   ├── _layout.svelte.js
│   │       │   │   ├── _page.server.ts.js
│   │       │   │   └── _page.svelte.js
│   │       │   └── hooks.server.js
│   │       ├── nodes
│   │       │   ├── 0.js
│   │       │   ├── 1.js
│   │       │   ├── 10.js
│   │       │   ├── 11.js
│   │       │   ├── 12.js
│   │       │   ├── 2.js
│   │       │   ├── 3.js
│   │       │   ├── 4.js
│   │       │   ├── 5.js
│   │       │   ├── 6.js
│   │       │   ├── 7.js
│   │       │   ├── 8.js
│   │       │   └── 9.js
│   │       ├── stylesheets
│   │       ├── env.js
│   │       ├── index.js
│   │       ├── internal.js
│   │       ├── manifest-full.js
│   │       ├── manifest.js
│   │       └── remote-entry.js
│   ├── types
│   │   ├── src
│   │   │   └── routes
│   │   │       ├── admin
│   │   │       │   ├── doctor
│   │   │       │   │   ├── $types.d.ts
│   │   │       │   │   └── proxy+page.server.ts
│   │   │       │   ├── jobs
│   │   │       │   │   ├── $types.d.ts
│   │   │       │   │   └── proxy+page.server.ts
│   │   │       │   ├── status
│   │   │       │   │   ├── $types.d.ts
│   │   │       │   │   └── proxy+page.server.ts
│   │   │       │   ├── storage
│   │   │       │   │   ├── $types.d.ts
│   │   │       │   │   └── proxy+page.server.ts
│   │   │       │   ├── $types.d.ts
│   │   │       │   └── proxy+page.server.ts
│   │   │       ├── api
│   │   │       │   ├── admin
│   │   │       │   │   ├── backfill
│   │   │       │   │   │   └── $types.d.ts
│   │   │       │   │   ├── daemon
│   │   │       │   │   │   ├── decisions
│   │   │       │   │   │   │   └── $types.d.ts
│   │   │       │   │   │   └── $types.d.ts
│   │   │       │   │   ├── jobs
│   │   │       │   │   │   └── $types.d.ts
│   │   │       │   │   ├── maintenance
│   │   │       │   │   │   └── $types.d.ts
│   │   │       │   │   ├── status
│   │   │       │   │   │   └── $types.d.ts
│   │   │       │   │   └── workers
│   │   │       │   │       └── $types.d.ts
│   │   │       │   ├── birth-feed
│   │   │       │   │   └── $types.d.ts
│   │   │       │   ├── events
│   │   │       │   │   └── $types.d.ts
│   │   │       │   ├── export
│   │   │       │   │   └── bulk
│   │   │       │   │       ├── [jobId]
│   │   │       │   │       │   ├── download
│   │   │       │   │       │   │   └── $types.d.ts
│   │   │       │   │       │   └── $types.d.ts
│   │   │       │   │       └── $types.d.ts
│   │   │       │   ├── releases
│   │   │       │   │   └── latest
│   │   │       │   │       └── $types.d.ts
│   │   │       │   ├── repo
│   │   │       │   │   └── [owner]
│   │   │       │   │       └── [repo]
│   │   │       │   │           ├── actions
│   │   │       │   │           │   └── $types.d.ts
│   │   │       │   │           ├── export
│   │   │       │   │           │   └── $types.d.ts
│   │   │       │   │           ├── files
│   │   │       │   │           │   ├── content
│   │   │       │   │           │   │   └── $types.d.ts
│   │   │       │   │           │   └── $types.d.ts
│   │   │       │   │           ├── state
│   │   │       │   │           │   └── $types.d.ts
│   │   │       │   │           └── timeline
│   │   │       │   │               └── $types.d.ts
│   │   │       │   ├── repos
│   │   │       │   │   └── $types.d.ts
│   │   │       │   ├── search
│   │   │       │   │   └── $types.d.ts
│   │   │       │   ├── snapshots
│   │   │       │   │   └── [id]
│   │   │       │   │       └── $types.d.ts
│   │   │       │   └── trends
│   │   │       │       └── $types.d.ts
│   │   │       ├── birth-feed
│   │   │       │   ├── $types.d.ts
│   │   │       │   └── proxy+page.server.ts
│   │   │       ├── repo
│   │   │       │   └── [owner]
│   │   │       │       └── [repo]
│   │   │       │           ├── compare-readme
│   │   │       │           │   ├── $types.d.ts
│   │   │       │           │   └── proxy+page.server.ts
│   │   │       │           ├── timeline
│   │   │       │           │   ├── $types.d.ts
│   │   │       │           │   └── proxy+page.server.ts
│   │   │       │           ├── $types.d.ts
│   │   │       │           └── proxy+page.server.ts
│   │   │       ├── robots.txt
│   │   │       │   └── $types.d.ts
│   │   │       ├── sitemap.xml
│   │   │       │   └── $types.d.ts
│   │   │       ├── $types.d.ts
│   │   │       └── proxy+page.server.ts
│   │   └── route_meta_data.json
│   ├── ambient.d.ts
│   ├── env.d.ts
│   ├── non-ambient.d.ts
│   └── tsconfig.json
├── data
│   ├── exports
│   │   └── bulk-export-77.zip
│   ├── dev-server-5176.err
│   ├── dev-server-5176.log
│   ├── githubarchive.db
│   ├── githubarchive.db-shm
│   └── githubarchive.db-wal
├── docs
│   ├── architecture-review
│   │   ├── README.md
│   │   ├── admin-and-operations.md
│   │   ├── api.md
│   │   ├── architecture.md
│   │   ├── configuration.md
│   │   ├── database.md
│   │   ├── dependencies.md
│   │   ├── intelligence.md
│   │   ├── overview.md
│   │   ├── performance.md
│   │   ├── product-review-and-roadmap.md
│   │   ├── repository-structure.md
│   │   ├── routes-and-ui.md
│   │   ├── search.md
│   │   ├── technical-debt.md
│   │   ├── testing.md
│   │   ├── website-discovery.md
│   │   └── workers-and-jobs.md
│   ├── LOCAL_DESKTOP.md
│   ├── METRICS.md
│   ├── migration011.sql
│   ├── PROPOSAL-autonomous-intelligence.md
│   ├── RESTORE.md
│   └── ROADMAP.md
├── scripts
│   ├── lib
│   │   ├── ingest-core.ts
│   │   └── inspect-hour.ts
│   ├── archive-repos.ts
│   ├── backfill-day.ts
│   ├── backfill-range.ts
│   ├── backfill-resume.ts
│   ├── backup.ts
│   ├── daemon.ts
│   ├── doctor.ts
│   ├── enrich-refresh.ts
│   ├── enrich-repos.ts
│   ├── ingest-hour.ts
│   ├── ingest-search.ts
│   ├── ingest-today.ts
│   ├── init-db.ts
│   ├── inspect-hour.ts
│   ├── load-env.ts
│   ├── restore.ts
│   ├── run-pipeline.ts
│   └── storage-analyze.ts
├── src
│   ├── lib
│   │   ├── components
│   │   │   ├── FileBrowser.svelte
│   │   │   └── RepoListItem.svelte
│   │   ├── server
│   │   │   ├── db
│   │   │   │   ├── admin-stats.ts
│   │   │   │   ├── archive-pulse.ts
│   │   │   │   ├── archive.ts
│   │   │   │   ├── backfill.ts
│   │   │   │   ├── birth-feed.ts
│   │   │   │   ├── category-stats.ts
│   │   │   │   ├── connection.ts
│   │   │   │   ├── daemon-decisions.ts
│   │   │   │   ├── events.ts
│   │   │   │   ├── fts.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── ingestion.ts
│   │   │   │   ├── jobs.ts
│   │   │   │   ├── metrics.ts
│   │   │   │   ├── releases.ts
│   │   │   │   ├── repo-history.ts
│   │   │   │   ├── repo-query.ts
│   │   │   │   ├── repos.ts
│   │   │   │   ├── schema.ts
│   │   │   │   ├── search-ingest.ts
│   │   │   │   └── types.ts
│   │   │   ├── workers
│   │   │   │   ├── archive.ts
│   │   │   │   ├── enrich.ts
│   │   │   │   ├── ingest.ts
│   │   │   │   ├── refresh.ts
│   │   │   │   └── search-gap.ts
│   │   │   ├── admin.ts
│   │   │   ├── apply-repo-intelligence.ts
│   │   │   ├── archive-outcomes.ts
│   │   │   ├── archiver.ts
│   │   │   ├── backfill-runner.ts
│   │   │   ├── background-daemon.ts
│   │   │   ├── backup.ts
│   │   │   ├── birth-feed.ts
│   │   │   ├── bulk-export.ts
│   │   │   ├── category-discovery.ts
│   │   │   ├── classify-repo.ts
│   │   │   ├── daemon-backlog.ts
│   │   │   ├── daemon-planner.ts
│   │   │   ├── doctor.ts
│   │   │   ├── enrich.ts
│   │   │   ├── event-bus.ts
│   │   │   ├── events.ts
│   │   │   ├── gharchive-hours.ts
│   │   │   ├── gharchive.ts
│   │   │   ├── github.ts
│   │   │   ├── intelligence.ts
│   │   │   ├── job-runner.ts
│   │   │   ├── markdown.ts
│   │   │   ├── record-repo-history.ts
│   │   │   ├── repo-discovery.ts
│   │   │   ├── repo-search.ts
│   │   │   ├── repo-state.ts
│   │   │   ├── repos.ts
│   │   │   ├── restore.ts
│   │   │   ├── snapshots.ts
│   │   │   ├── source-archive.ts
│   │   │   ├── source-browser.ts
│   │   │   ├── source-zip.ts
│   │   │   ├── storage.ts
│   │   │   ├── summarize-repo.ts
│   │   │   ├── topics-normalize.ts
│   │   │   ├── worker-control.ts
│   │   │   └── zip-stream.ts
│   │   ├── category-labels.ts
│   │   ├── evidence.ts
│   │   ├── repo-nav.ts
│   │   └── utils.ts
│   ├── routes
│   │   ├── admin
│   │   │   ├── doctor
│   │   │   │   ├── +page.server.ts
│   │   │   │   └── +page.svelte
│   │   │   ├── jobs
│   │   │   │   ├── +page.server.ts
│   │   │   │   └── +page.svelte
│   │   │   ├── status
│   │   │   │   ├── +page.server.ts
│   │   │   │   └── +page.svelte
│   │   │   ├── storage
│   │   │   │   ├── +page.server.ts
│   │   │   │   └── +page.svelte
│   │   │   ├── +layout.svelte
│   │   │   ├── +page.server.ts
│   │   │   └── +page.svelte
│   │   ├── api
│   │   │   ├── admin
│   │   │   │   ├── backfill
│   │   │   │   │   └── +server.ts
│   │   │   │   ├── daemon
│   │   │   │   │   ├── decisions
│   │   │   │   │   │   └── +server.ts
│   │   │   │   │   └── +server.ts
│   │   │   │   ├── jobs
│   │   │   │   │   └── +server.ts
│   │   │   │   ├── maintenance
│   │   │   │   │   └── +server.ts
│   │   │   │   ├── status
│   │   │   │   │   └── +server.ts
│   │   │   │   └── workers
│   │   │   │       └── +server.ts
│   │   │   ├── birth-feed
│   │   │   │   └── +server.ts
│   │   │   ├── events
│   │   │   │   └── +server.ts
│   │   │   ├── export
│   │   │   │   └── bulk
│   │   │   │       ├── [jobId]
│   │   │   │       │   ├── download
│   │   │   │       │   │   └── +server.ts
│   │   │   │       │   └── +server.ts
│   │   │   │       └── +server.ts
│   │   │   ├── releases
│   │   │   │   └── latest
│   │   │   │       └── +server.ts
│   │   │   ├── repo
│   │   │   │   └── [owner]
│   │   │   │       └── [repo]
│   │   │   │           ├── actions
│   │   │   │           │   └── +server.ts
│   │   │   │           ├── export
│   │   │   │           │   └── +server.ts
│   │   │   │           ├── files
│   │   │   │           │   ├── content
│   │   │   │           │   │   └── +server.ts
│   │   │   │           │   └── +server.ts
│   │   │   │           ├── state
│   │   │   │           │   └── +server.ts
│   │   │   │           └── timeline
│   │   │   │               └── +server.ts
│   │   │   ├── repos
│   │   │   │   └── +server.ts
│   │   │   ├── search
│   │   │   │   └── +server.ts
│   │   │   ├── snapshots
│   │   │   │   └── [id]
│   │   │   │       └── +server.ts
│   │   │   └── trends
│   │   │       └── +server.ts
│   │   ├── birth-feed
│   │   │   ├── +page.server.ts
│   │   │   └── +page.svelte
│   │   ├── repo
│   │   │   └── [owner]
│   │   │       └── [repo]
│   │   │           ├── compare-readme
│   │   │           │   ├── +page.server.ts
│   │   │           │   └── +page.svelte
│   │   │           ├── timeline
│   │   │           │   ├── +page.server.ts
│   │   │           │   └── +page.svelte
│   │   │           ├── +page.server.ts
│   │   │           └── +page.svelte
│   │   ├── robots.txt
│   │   │   └── +server.ts
│   │   ├── sitemap.xml
│   │   │   └── +server.ts
│   │   ├── +layout.svelte
│   │   ├── +page.server.ts
│   │   └── +page.svelte
│   ├── app.css
│   ├── app.d.ts
│   ├── app.html
│   └── hooks.server.ts
├── static
│   └── favicon.svg
├── tests
│   ├── helpers
│   │   ├── db.ts
│   │   └── tar.ts
│   ├── archive-outcomes.test.ts
│   ├── archive-queue.test.ts
│   ├── bulk-export-zip.test.ts
│   ├── category-discovery.test.ts
│   ├── daemon-decisions.test.ts
│   ├── daemon-migration.test.ts
│   ├── daemon-planner.test.ts
│   ├── ingest-cycle-status.test.ts
│   ├── ingestion-missing-hours.test.ts
│   ├── orphan-jobs.test.ts
│   ├── repo-history.test.ts
│   ├── repo-intelligence.test.ts
│   ├── repo-nav.test.ts
│   ├── source-browser.test.ts
│   └── source-zip.test.ts
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── package-lock.json
├── package.json
├── railway.toml
├── start-githubarchive.bat
├── stop-githubarchive.bat
├── svelte.config.js
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## Generated and local-state caveats

- `.svelte-kit` names are build hashes and will change after source/build-tool changes. It includes the dead `/admin/status` route because it was present during the build.
- `data/githubarchive.db-wal` contains the logical schema pages even though the main database file is only one page. Deleting/copying only the main file while a writer is active is unsafe.
- `data/exports/bulk-export-77.zip` and `dev-server-5176.*` are generated local artifacts, not source. They were retained and documented because the request prohibited deletion and excluded only the named directories.
- The checked-in/source-export state cannot be distinguished from ignored/untracked state because `.git` is absent.
