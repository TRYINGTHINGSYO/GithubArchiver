# Current-branch delta review

- Prior review: `main` @ `7a61a65` (`docs/architecture-review/*`, schema v13 export)
- Current review (code under analysis): `origin/cursor/intelligence-discovery-redesign-1514` @ `2b77ed95201b0c395b445bdbb475966bedcc83bc` (PR #28 head)
- Labels: `still true` · `partially fixed` · `fixed` · `changed architecture` · `unable to verify`

## Step 1 verification (source under review)

| Check | Result |
|---|---|
| Code branch reviewed | `origin/cursor/intelligence-discovery-redesign-1514` (PR #28) |
| Code commit reviewed | `2b77ed95201b0c395b445bdbb475966bedcc83bc` |
| PR #28 present | **Yes** — commits `042ad1f` … `2b77ed9`; GitHub PR open: Website Discovery Redesign Foundation |
| Highest migration | **044** (`migration044` in `src/lib/server/db/schema.ts`) |
| Executable schema version | **44** (`CURRENT_SCHEMA_VERSION = 44`) |
| Migration 044 exists | **Yes** — creates `website_ratings`, `website_user_state`, `collection_items`, domain aggregate columns |
| `/websites` | **Yes** — `src/routes/websites/+page.{server.ts,svelte}` |
| `/websites/random` | **Yes** — `src/routes/websites/random/+page.{server.ts,svelte}` |
| `/websites/[domain]` | **Yes** — `src/routes/websites/[domain]/+page.{server.ts,svelte}` |
| `/favorites` | **Yes** — `src/routes/favorites/+page.{server.ts,svelte}` |
| Website ratings | **Yes** — `website_ratings` + `src/lib/server/website-ratings.ts` + `POST/DELETE /api/websites/[domain]/rating` |
| Website favorites | **Yes** — `collection_items` / `addWebsiteToCollection` + `PUT/DELETE /api/websites/[domain]/favorite` |
| Polymorphic `collection_items` | **Yes** — `item_type IN ('repository','website')` |
| Three-column shell | **Yes** — `src/routes/+layout.svelte` (`LeftNav` / center / `RightRail`) |

---

## Reassessment of prior high-impact findings

### 1. Authentication and authorization — **partially fixed**

**Prior claim:** every page/endpoint unauthenticated; no session/role model.

**Current evidence:**
- Admin session cookie `gha_admin` with HMAC — `src/lib/server/auth.ts` (`createAdminSessionValue`, `verifyAdminSessionValue`)
- Login/logout — `src/routes/login/+page.server.ts`, `src/routes/logout/+server.ts`
- Hooks gate `/admin`, `/admin/*`, `/api/admin/*` — `src/hooks.server.ts`
- Repo admin actions gated inline — `src/routes/api/repo/[owner]/[repo]/actions/+server.ts`
- Anonymous owner cookie for personal curation — `src/lib/server/collection-owner.ts`

**Still open:**
- Default password `'GitHub'` when `ADMIN_PASSWORD` unset
- Session secret falls back to password
- Public mutations remain: `/api/repo/save`, emerging-topic POST, bulk export GET, archive-story regenerate
- No centralized `requireAdmin()` helper
- No mutation audit log

Severity remaining: **P0** for ungated destructive/global mutations; admin surface itself is no longer fully open.

### 2. CSRF protection — **still true**

**Prior claim:** no CSRF/origin protection; GET mutations especially risky.

**Current evidence:**
- No Origin/Referer/CSRF-token checks under `src/`
- Cookie `sameSite: 'lax'` only (`auth.ts`)
- Bulk export still starts via **GET** — `src/routes/api/export/bulk/+server.ts`
- Logout is GET — `src/routes/logout/+server.ts`

Severity: **P0** for cookie-authenticated admin mutations and GET-based export start.

### 3. Destructive admin endpoints — **partially fixed**

**Prior claim:** doctor/storage/cleanup fully public.

**Current evidence:**
- `/api/admin/maintenance` now requires admin session via hooks
- Cleanup presets/preview/quarantine/restore/purge exist (`cleanup_*` actions)
- Restore remains CLI-only (`scripts/restore.ts`) — good

**Still open:**
- No CSRF/origin on admin POSTs
- No mandatory backup/confirm token before purge/delete
- No audit trail of who deleted what
- Default weak admin password in production if env unset

Severity: **P0** (auth present but incomplete; destructive power still easy to abuse if session stolen or default password used).

### 4. TypeScript errors — **partially fixed** (count/shape changed)

**Prior claim:** 32 `tsc` errors; Vite build green.

**Current evidence (this branch):**
- `npm run build` → exit **0**
- `npx tsc --noEmit` → exit **2**, **63** errors
- Dominant class: worker/job result types not assignable to `Record<string, unknown>`
- Runtime-relevant: missing `renderMarkdownSafe` / `diffLines` imports; `sourceAnalysis` narrowed to `never` (`repos.ts:1678`)

Severity: **P1** for runtime-relevant symbols; remaining type debt is **P2** unless CI gates on `tsc`.

### 5. Missing README comparison symbols — **still true** (symbols exist, imports missing)

**Prior claim:** undefined `renderMarkdownSafe` and `diffLines` → runtime `ReferenceError`.

**Current evidence:**
- Symbols **defined** in `src/lib/server/markdown.ts`
- `compare-readme/+page.server.ts` still calls them **without imports** (lines 40–42)
- `tsc` reports `TS2304` for both names

Severity: **P1** — page fails at runtime when comparison is requested.

### 6. `sourceAnalysis: null` — **still true**

**Prior claim:** `getRepoWithSnapshots` hardcodes `sourceAnalysis: null`.

**Current evidence:**
- `src/lib/server/repos.ts` line ~1630: `const sourceAnalysis: SourceAnalysis | null = null;`
- Detail page still hydrates from `data.sourceAnalysis` and can fetch analysis via actions, but SSR path remains disconnected
- `tsc`: `security_files` on type `never`

Severity: **P1**.

### 7. Source archive refresh behavior — **still true**

**Prior claim:** once any source snapshot exists, automated archive never re-selects the repo.

**Current evidence:**
- `listEnrichedReposForArchive` — `src/lib/server/db/repos.ts` — `NOT EXISTS (... snapshot_type = 'source')`
- `countUnarchivedSourceSnapshots` — `src/lib/server/daemon-backlog.ts` — same predicate
- `tests/archive-queue.test.ts` encodes one-shot semantics (“selects only enriched repos missing a source snapshot”)
- Manual archive / export paths can still recapture

Severity: **P1** for preservation correctness.

### 8. Single-process worker architecture — **changed architecture** / **partially fixed**

**Prior claim:** daemon + SSR + API in one Node process only.

**Current evidence:**
- Production launcher spawns **web + daemon** as sibling processes — `scripts/start-production.ts` sets `BACKGROUND_WORKER=0` on web
- Dev/hooks still call `ensureBackgroundWorker()` — `src/hooks.server.ts`
- Manual jobs can still run heavy work inside the web process via admin workers API
- No durable multi-node lease/heartbeat for exclusive ownership

Severity remaining: **P2**.

### 9. Synchronous SQLite contention — **still true**

**Prior claim:** sync `better-sqlite3` + fs/gunzip on event loop.

**Current evidence:**
- Engine unchanged (`better-sqlite3`)
- Splitting daemon process reduces but does not eliminate contention on shared SQLite file
- Heavy maintenance (doctor/storage) still synchronous in request path when invoked

Severity: **P2**.

### 10. Website discovery — **partially fixed** / **changed architecture**

**Prior claim:** homepage + README link extraction only; no crawl/verify.

**Current evidence:**
- CT / zone / verify workers: `src/lib/server/workers/website-ct.ts`, `website-zone.ts`, `website-verify.ts`
- Tables: `candidate_domains`, verify status, backoff (`migration037` + 044)
- Feed UI: `/websites`
- Still absent / thin: screenshots, rich crawl content, dead-site operator UX, moderation

Severity remaining: **P3** for product depth; pipeline foundation is real.

### 11. Website ratings — **fixed** (foundation)

**Prior claim:** absent.

**Current evidence:**
- Schema: `website_ratings` + aggregates on `candidate_domains` (migration 044)
- Service: `src/lib/server/website-ratings.ts`
- API: `src/routes/api/websites/[domain]/rating/+server.ts`
- UI: domain page + random page
- Tests: `tests/website-curation.test.ts`

Remaining product gaps (anti-abuse beyond anonymous cookie, public profiles) are **P3**, not “absent.”

### 12. Website favorites — **fixed** (foundation)

**Prior claim:** absent.

**Current evidence:**
- `addWebsiteToCollection` / `collection_items` dual-write — `src/lib/server/db/collections.ts`
- API: `/api/websites/[domain]/favorite`
- UI: `/favorites` lists websites + repos

### 13. Collections — **partially fixed** → effectively **fixed** for system collections

**Prior claim:** absent.

**Current evidence:**
- System collections `favorites` / `watch_later` for repos (migration 041) and polymorphic items (044)
- APIs under `/api/collections/*`
- Not a full social/public/shared collection product — that remains **P3**

### 14. Random website discovery — **fixed** (foundation)

**Prior claim:** absent (prior text often said random *repo* discovery).

**Current evidence:**
- Route `/websites/random` with keyboard shortcuts (`src/lib/random-website-shortcuts.ts`)
- Eligibility via `random_eligible` + live verify status
- Hide/skip via `website_user_state`
- Tests in `website-curation.test.ts`

### 15. Cluster generation — **fixed** (relative to prior “absent”), with correctness caveat

**Prior claim:** clusters absent entirely.

**Current evidence:**
- Registry: `CLUSTER_DEFINITIONS` — `src/lib/server/cluster-registry.ts`
- Assignments: `repository_cluster_memberships`, worker `src/lib/server/workers/cluster.ts`
- Discovery surfaces: homepage + `/discover` + APIs
- **Caveat:** after DB wipe, materialized “fastest-growing” cards can remain (see empty-volume defect). Fix landed on `main` via PR #30 (`2c5b89f`) but is **not** on this PR #28 branch.

Status for clustering existence: **fixed**. Status for empty-volume correctness: **still true defect** (see dedicated report).

### 16. Classification confidence — **partially fixed**

**Prior claim:** fixed rule constants only; no calibrated confidence.

**Current evidence:**
- `classify-repo.ts` computes score-derived confidence (`Math.min(0.95, …)`) — still heuristic, not calibrated
- Not a probabilistic/calibrated model; no human-feedback loop into weights

Severity: **P3** (quality), not release-blocking.

### 17. Human intelligence review — **partially fixed**

**Prior claim:** absent.

**Current evidence:**
- Admin intelligence page + `POST /api/admin/intelligence/review` (admin-gated)
- Emerging topic review UI/API exists but **POST is unauthenticated** — `src/routes/api/discovery/emerging/[key]/+server.ts`
- No broad moderation queue for websites

Severity: review foundation **partial**; ungated emerging mutations are **P0**.

### 18. Duplicate detection — **partially fixed**

**Prior claim:** repo duplicate detection absent (only archive SHA duplicates).

**Current evidence:**
- Emerging-topic duplicate grouping / similarity evidence — `src/lib/server/emerging-topics.ts`
- Storage SHA duplicate cleanup still artifact-level — `src/lib/server/storage.ts`
- `github_id` duplicate cleanup presets — `src/lib/server/low-value-cleanup.ts`
- Still no general fork/mirror/template repository-identity merge product

Severity: **P3** for product completeness.

### 19. Search — **still true** (core shape) with product progress elsewhere

**Prior claim:** FTS5 only; no semantic; snippet `{@html}` risk; no rate limit.

**Current evidence:**
- Search still SQLite FTS5
- Snippets still rendered with `{@html}` — `RepoCard.svelte`, `RepoListItem.svelte`
- No semantic/embedding search found
- Discovery UX expanded (websites, clusters) but search engine itself largely unchanged

Severity: XSS/snippet hygiene **P1** if snippets can contain attacker-controlled HTML; otherwise search product gaps **P3**. Treat snippet escaping as hardening in packet 10 / security follow-up.

### 20. Current database schema documentation — **changed architecture** / **partially fixed**

**Prior claim:** executable schema v13; README still says v9; review docs inventory v13.

**Current evidence:**
- Executable schema **v44**
- Prior architecture-review docs on `main` are stale (v13)
- `docs/ROADMAP.md` still mentions “schema v9” in shipped history line
- Memory seed/migrations notes updated for 044 on this branch
- No refreshed full table inventory document on this branch yet (this delta + packets substitute)

Severity: **P3** documentation drift (does not block runtime).

---

## Priority classification (current branch)

### P0 — Security or destructive-data risk

1. CSRF/origin missing on admin and other cookie-authenticated mutations
2. Default `ADMIN_PASSWORD` (`GitHub`) / session secret fallback
3. Ungated global mutations: `/api/repo/save`, emerging-topic POST, bulk export GET start/download, archive-story regenerate
4. Destructive admin actions lack confirm-token / audit log (auth helps but is incomplete)

### P1 — Correctness or runtime failure

1. README compare missing imports → runtime failure
2. `sourceAnalysis` always null on detail SSR loader
3. One-shot source archive selection (no recurring refresh)
4. Empty-volume / stale materialized cluster cards (PR #30 fix not on this branch)
5. `tsc` failures that encode real bugs (`never` narrowing around `sourceAnalysis`, missing symbols)
6. Search snippet `{@html}` without proven sanitizer on FTS fragments

### P2 — Reliability and scalability

1. Sync SQLite contention across web + daemon
2. Heavy work still invokable in-process via admin/job APIs
3. Materialization/TTL cache invalidation gaps
4. Broad `Record<string, unknown>` typing debt (63 `tsc` errors)
5. Unbounded / expensive operator queries during maintenance

### P3 — Product and UX

1. Website screenshots, richer crawl, moderation UX
2. Calibrated confidence / ML quality
3. Public/shared collections, accounts beyond anonymous cookie
4. Semantic search, similarity browsing
5. Documentation sync (roadmap schema v9 wording; full schema inventory refresh)

---

## What the prior review got wrong because the export was stale

| Prior assertion | Reality on PR #28 @ `2b77ed9` |
|---|---|
| Schema v13 | Schema **v44** |
| Ratings/favorites/collections/random absent | **Implemented** with migration 044 + routes/APIs/tests |
| Clusters absent | **Implemented** (with wipe/materialization defect) |
| Human review absent | Admin intelligence review + emerging review exist (emerging POST ungated) |
| No auth at all | Admin session + `/admin*` gate exist |
| Website discovery = homepage/README only | CT/zone/verify pipeline + websites UI |
| Three-column shell absent | Present in root layout |

Do not treat the v13 export documents as authoritative for website/curation/cluster presence.
