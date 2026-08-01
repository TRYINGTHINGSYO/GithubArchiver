# Pages, routes, UI, and components

## Visual and interaction system

The application is a server-rendered Svelte 5 interface with page-local CSS and shared global styles in `src/app.css`. It uses a dark archival/dashboard aesthetic, native form controls, inline SVG/icons, cards, badges, tables, and responsive grids. There is no component library, design-token package, storybook, visual regression suite, internationalization framework, or accessibility test tooling.

The global layout provides the GithubArchive+ brand and primary links to Home, Birth Feed, and Admin. The admin nested layout provides Control, Job history, Health, and Storage tabs. There is no user/account area because identity does not exist.

No screenshots exist under `static`, `docs`, or source; `static/favicon.svg` is the only static visual asset. A new runtime screenshot set could not be captured because the current Node/native SQLite ABI mismatch prevents the app from loading the database. The source and generated UI were inspected directly.

## Page route inventory

All page routes are unauthenticated. The following matrix makes their loader/component/client-endpoint dependencies explicit.

| Route | Server data | Reusable components | Client API calls / links |
|---|---|---|---|
| `/` | Repository list, global stats, languages, archive pulse | `RepoListItem` | Links to `/api/repos`, `/api/search`, `/api/events`, `/api/releases/latest`; normal search/filter is SSR query navigation |
| `/birth-feed` | Birth list/sources/languages, trends, live overview | None; page-local cards/feed | Polls `/api/events`; links `/api/birth-feed`, `/api/trends` |
| `/repo/{owner}/{repo}` | Full repository projection, snapshots, readmes, releases, history, evidence/scores, related | `FileBrowser` | POST actions; polls repo-filtered `/api/events`; file tree/content; snapshot/export links |
| `/repo/{owner}/{repo}/timeline` | `getRepoTimeline` | None | No client fetch required |
| `/repo/{owner}/{repo}/compare-readme` | Validated README snapshots, text/render/diff | None | No client fetch; loader currently fails on undefined helpers |
| `/admin` | `getAdminStatus` | None | Posts daemon/workers/backfill; `invalidateAll()` reloads loader every 10s |
| `/admin/jobs` | 100 recent/type-filtered jobs and selection id | None | Fetches `/api/admin/jobs?id=...` for selected detail |
| `/admin/doctor` | `getDoctorReport` | None | Posts doctor repairs to `/api/admin/maintenance` |
| `/admin/storage` | `getStorageReport` | None | Starts/polls bulk export; posts storage cleanup to maintenance |
| `/admin/status` | Redirect only | Dead page-local legacy UI is compiled | If bypassed it would call old daemon/worker/backfill controls, but server redirect prevents use |
| `/robots.txt` | Generated from request origin | None | None |
| `/sitemap.xml` | Generated from request origin | None | None |

### `/` — discovery home

**Loader.** Parses all repository filters, calls `listRepos`, `getRepoStats`, `getAvailableLanguages`, and `getArchivePulse`.

**Visible systems.** Hero/mission statement; archive pulse and aggregate stats; featured/new activity presentation; FTS search; language/year/source/status/archive/release/star/fork filters; sort/feed modes; repository result cards; empty/error states; pagination; links to API discovery.

**Data source.** `repos`, FTS, snapshots, releases, events, aggregate counts. Each result is projected through repository summary helpers.

**Interaction.** Query-string form and pagination cause SSR navigation. Repository cards are keyboard/click navigable while their nested controls stop propagation.

**Issues.** Summary projection performs archive badge/ZIP lookups per result, creating N+1 queries. The page uses a large page-local component (637 lines). No personalization, random feed, or saved search.

### `/birth-feed` — repository birth and activity feed

**Loader.** Parses filters, lists birth-feed repositories, sources, languages, trend snapshot, and live overview.

**Visible systems.** Live, trending, and archive tabs; new repositories; source/language/date/status controls; trend/overview modules; recent event stream; pagination.

**Client behavior.** Polls `/api/events?limit=30` and maintains a live cursor. The “live” supplement is a process-local ring, so events reset on restart and differ across replicas.

**Issues.** `parseBirthFeedParams` exists in the server birth-feed module but route code uses the shared repo parser instead; the exported function appears unused. There is no websocket/SSE transport, backpressure, or durable live cursor.

### `/repo/{owner}/{repo}` — repository detail

**Loader.** `getRepoWithSnapshots` builds a very broad view model and sets a private 60-second cache with five-minute stale-while-revalidate.

**Visible systems.** Repository identity/avatar/status; GitHub/homepage/timeline/ZIP links; manual Refresh, Archive, and Reanalyze source actions; metadata, topics and lifecycle dates; deterministic summary/category; intelligence report; preservation score; recoverability; evidence groups; repository story/project signal; website/registry/social/README links; README rendering and history comparison links; source file browser; archive snapshot list; releases; related projects; historical timeline.

**Interactions.** Actions POST to the repository action endpoint, show progress/error, then invalidate/reload data. File browser loads tree/content lazily. Snapshot/export links download or trigger capture.

**Critical disconnect.** The aggregate loader hardcodes `sourceAnalysis: null`. Any detail section derived from top-level source analysis, including `security_files`, technologies, languages, and file evidence, cannot receive data through SSR. Reanalysis computes a response but reloading returns null again. The separate file-browser endpoint still works.

**Security/content issues.** README rendering uses `marked` followed by regular-expression stripping, not a proven HTML sanitizer. Raw HTML and unusual URL schemes/attribute forms deserve security testing. External links/images can leak visitor IP/referrer to third parties.

**Size.** Largest source page at 1,525 lines; generated client node about 29.4 KiB and server-rendered module about 33.9 KiB, plus shared chunks and about 19.9 KiB of route CSS.

### `/repo/{owner}/{repo}/timeline`

**Loader/UI.** Fetches repository timeline and releases, renders chronological events with labels/payload details and repository navigation. This is a focused version of history already partially visible on the detail page.

**Limitations.** Timeline events cover only implemented event emitters, not an authoritative diff of every current-state mutation. Payload JSON is schema-less.

### `/repo/{owner}/{repo}/compare-readme?from={id}&to={id}`

**Loader/UI.** Intended to validate two README snapshot ids for the same repository, load files, render safe Markdown versions, and compute line diff; page presents side-by-side/rendered/diff comparison.

**Known defect.** `+page.server.ts` calls `renderMarkdownSafe` and `diffLines` without importing or defining them. Vite's production build does not type-check this and succeeds, but the route can throw `ReferenceError` when a valid comparison reaches those lines. Invalid/missing snapshot selections can fail earlier and hide the bug.

### `/admin` — operations control

**Loader.** Calls `getAdminStatus`.

**Visible systems.** Daemon state/control; one-click pipeline/ingest/missing-hour/search/enrich/archive/refresh/backup jobs; backfill creation/resume; repository/archive/enrichment/backlog/ingestion/search/rate-limit/backup/storage stats; recent jobs and errors; daemon log; auto-refresh status.

**Client behavior.** Polls the status API about every 10 seconds and posts action bodies to admin endpoints. Buttons reflect the process-local manual-runner busy state.

More precisely, the page calls SvelteKit `invalidateAll()` every ten seconds, causing its server loader to recompute `getAdminStatus`; it does not fetch `/api/admin/status` directly.

**Issues.** Entire page and all actions are public. It is a 992-line page with many operator domains coupled together. Status polling can cause repeated aggregate queries and upstream rate-limit checks.

### `/admin/jobs`

**Loader/UI.** Optional `id` and `type`; lists job history with pagination/filter, displays status/times/errors/reason and formatted parsed detail for a selected job. Useful for worker forensics but exposes raw operational data without access control.

### `/admin/doctor`

**Loader/UI.** Runs/read-displays database opening, schema, snapshot file/path, orphan archive, FTS row count, recent job failure, and daemon checkpoint checks. Offers repairs to rebuild FTS and mark missing snapshot evidence.

**Operational behavior.** Repair runs synchronously in the web process. “Mark missing snapshots” records archive-failure evidence for drift rather than reconstructing lost files.

### `/admin/storage`

**Loader/UI.** Walks archive storage, lists totals, largest repositories, duplicate hashes, orphan files, old snapshots, and samples. Offers delete-orphan, delete-duplicate, and trim-old maintenance actions plus bulk export controls.

**Risk.** Analysis performs synchronous recursive filesystem work. Cleanup is destructive and unauthenticated. Duplicate deletion protects selected latest rows and path references, but a backup/confirmation workflow is not enforced.

### `/admin/status`

The server loader immediately issues a 307 redirect to `/admin`. Its 712-line `+page.svelte` remains compiled into client/server output and duplicates an older status dashboard, but users cannot reach it through normal routing. It is dead/unreachable UI and increases bundle/build maintenance surface.

### `/robots.txt` and `/sitemap.xml`

Described in the API reference. They are endpoint routes rather than rendered pages.

## Shared component inventory

Only two reusable Svelte components exist.

### `RepoListItem.svelte`

**Purpose.** Reusable repository summary/card on discovery feeds.

**Props/inputs.** One `repo: RepoListItemData` prop containing owner/name/full name, creation/first-seen timestamps, optional description/language/stars/search snippet, deleted/enriched timestamps, and an optional `archive_badges` object (`preserved`, `readmeSaved`, `sourceSaved`, `storyReady`, `deletedButSaved`).

**Dependencies/usage.** Imports repository navigation behavior and shared formatting/category helpers; used only by the Home result list.

**State/derivations.** Builds repository path, timestamp labels, archive badge text/links, and fallback story/summary. Handles click and keyboard navigation while protecting nested interactive elements.

**Rendering.** Name/owner, category/language/status badges, description or search context, stars/dates, archive links, and preservation indicators.

**Security note.** Search snippet is rendered with Svelte `{@html}`. The snippet is expected to be SQLite FTS output containing mark tags, but no sanitizer is applied at the component boundary. Any future query/source change that allows stored markup into the snippet could create XSS.

**Complexity.** 159 lines. It is modest, but combines navigation semantics, archive/story derivation, accessibility events, and visual styling in one card.

### `FileBrowser.svelte`

**Purpose.** Browse the latest archived source tarball without downloading it.

**Props/inputs.** `owner: string`, `name: string`, `hasSource: boolean`, and optional `onArchive?: () => void`.

**Dependencies/usage.** Calls repository files/content HTTP endpoints and uses file-tree/language metadata returned by server helpers; used only by repository detail.

**State.** Tree-loading/error state, expanded directories, selected file, file-loading/error/content state. Fetches `/files` once and `/files/content?path=` on selection.

**Rendering.** Recursive folder tree, file language class, text viewer, binary/truncation messages, archive-source call to action.

**Limits.** Server analysis exposes at most configured parser limits (7,000 entries scanned, 800 files returned, 200 folders in current code) and individual text content defaults to 512,000 bytes. Client recursion and large text rendering have no virtualization.

**Complexity.** 347 lines. It contains recursive tree rendering, two remote-loading state machines, error/empty/binary/truncation modes, file-language display, and component CSS; this is the more complex reusable component.

## Page-local components and coupling

All other UI composition, formatting, fetch logic, tabs, dialogs/confirmations, score displays, charts/bars, tables, and cards live directly in route `+page.svelte` files. This produces several large components and duplicated controls. There are no reusable primitives for buttons, notices, modal confirmation, pagination, filters, status badges, tables, metric cards, job actions, evidence groups, or archive actions.

## Accessibility and UX observations

- Repository cards include keyboard handling, a positive accessibility choice.
- Native links/buttons/forms are used extensively, but there is no automated axe/playwright coverage to validate names, focus, contrast, table semantics, or announcements.
- Long-running actions rely on page-local status text; there is no consistent progress component, cancellation, background notification, or resumable UI state.
- Admin destructive controls lack a strong typed confirmation workflow and authenticated operator context.
- Mobile behavior is implemented through page CSS breakpoints, but no device screenshots or browser tests exist.
- Error states are local strings; no global error/toast system or support correlation id exists.
- There is no localization. The hook intentionally 404s `/en/*` and `/es/*` routes.

## Features requested for review but not represented in UI

There are no screens or components for user login, profile, favorites, ratings, collections, moderation, review queues, cluster browsing, semantic similarity, duplicate repositories, website screenshots/health history, dead-site review, random repository discovery, dependency graphs, notification settings, or analytics administration.
