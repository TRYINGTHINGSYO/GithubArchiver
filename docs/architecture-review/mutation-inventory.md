# Mutation inventory and access-control assessment

- Branch/commit: `cursor/architecture-review-delta-2dbd` @ `2b77ed9`
- Prior claim (“all pages and destructive admin unauthenticated”): **partially outdated**
- Remaining claim: **admin UI/API gated, but CSRF absent and several high-impact mutations still public**

## Current auth model (as implemented)

| Piece | Implementation |
|---|---|
| Admin password | `ADMIN_PASSWORD` or default `'GitHub'` — `src/lib/server/auth.ts` |
| Session | Cookie `gha_admin` = `admin:<ts>.<hmac>`; 7-day max age |
| Session secret | `ADMIN_SESSION_SECRET` or falls back to password |
| Cookie flags | `httpOnly`, `sameSite: 'lax'`, `secure` in production |
| Gate | `src/hooks.server.ts` redirects/401s for `/admin`, `/admin/*`, `/api/admin/*` |
| Anonymous curation owner | Cookie `gha_anonymous_owner` → `anon:<uuid>` — `collection-owner.ts` |
| CSRF / Origin | **None** in application code |
| Audit log | **None** for mutations |

Roles in practice: **anonymous visitor** (personal collections/ratings) and **admin** (operator). No multi-user accounts.

---

## Inventory

CSRF column: **None (app)** means no token/origin check. SameSite=Lax may mitigate some cross-site POSTs but does **not** cover GET mutations or all JSON cases.

### Auth session

| Route | Method | Action | Destructive impact | Auth | Authz | CSRF | Ownership | Recommended protection |
|---|---|---|---|---|---|---|---|---|
| `/login` | POST (form `default`) | Create admin session | low | Public | N/A | Form POST only | N/A | Require strong `ADMIN_PASSWORD` in prod; rate-limit; optional Origin check |
| `/logout` | GET | Clear admin session | low | N/A | N/A | GET logout CSRF possible | N/A | Prefer POST + Origin check |

### Admin workers / daemon / jobs

| Route | Method | Action | Destructive impact | Auth | Authz | CSRF | Ownership | Recommended protection |
|---|---|---|---|---|---|---|---|---|
| `/api/admin/workers` | POST `pipeline` | Queue full pipeline | high | Admin cookie (hooks) | admin | None (app) | global | keep admin + Origin/CSRF + audit |
| `/api/admin/workers` | POST `ingest` / `ingest-missing` / `search-ingest` / `trending-ingest` | Queue ingestion | high | Admin | admin | None | global | same |
| `/api/admin/workers` | POST `enrich` / `refresh` | Queue enrich/refresh | medium–high | Admin | admin | None | global | same |
| `/api/admin/workers` | POST `archive` | Queue archive worker | **critical** | Admin | admin | None | global | same + confirm for bulk |
| `/api/admin/workers` | POST `backup` | Queue DB backup | high | Admin | admin | None | global | same |
| `/api/admin/workers` | POST `discovery-materialize` / `homepage-readiness-materialize` | Queue materialization | medium | Admin | admin | None | global | same |
| `/api/admin/daemon` | POST `start`/`stop` | Control daemon | **critical** | Admin | admin | None | global | same |
| `/api/admin/backfill` | POST | Create/resume backfill | high | Admin | admin | None | global | same |
| `/api/admin/jobs` | GET | List jobs | none | Admin | admin | N/A | global | ok |
| `/api/admin/status` | GET | Status | none | Admin | admin | N/A | global | ok |

### Maintenance / repair / storage cleanup

| Route | Method | Action | Destructive impact | Auth | Authz | CSRF | Ownership | Recommended protection |
|---|---|---|---|---|---|---|---|---|
| `/api/admin/maintenance` | POST `doctor` | Health check / optional repairs | high | Admin | admin | None | global | admin + CSRF + audit; dry-run default |
| `/api/admin/maintenance` | POST `storage` | Analyze; optional delete orphans/dupes/trim/vacuum | **critical** | Admin | admin | None | global | confirm token + backup prerequisite + audit |
| `/api/admin/maintenance` | POST `retention` | Apply retention | **critical** | Admin | admin | None | global | same |
| `/api/admin/maintenance` | POST `cleanup_preview` / `cleanup_presets` | Preview low-value cleanup | low/none | Admin | admin | None | global | ok with CSRF |
| `/api/admin/maintenance` | POST `cleanup_quarantine` | Quarantine repos | high | Admin | admin | None | global | CSRF + audit |
| `/api/admin/maintenance` | POST `cleanup_restore` | Restore quarantined | medium | Admin | admin | None | global | CSRF + audit |
| `/api/admin/maintenance` | POST `cleanup_purge` | Permanent purge | **critical** | Admin | admin | None | global | confirm token + CSRF + audit |

### Archive create / delete / restore

| Route | Method | Action | Destructive impact | Auth | Authz | CSRF | Ownership | Recommended protection |
|---|---|---|---|---|---|---|---|---|
| `/api/repo/[owner]/[repo]/actions` | POST `archive` | Archive one repo | **critical** (storage growth / GitHub load) | Inline `locals.isAdmin` | admin | None | global | keep admin + CSRF |
| `/api/repo/[owner]/[repo]/actions` | POST `refresh` / `reanalyze-source` / `favorite` | Refresh / reanalyze / admin favorite protect | medium | Admin | admin | None | global | CSRF |
| `/api/repo/save` | POST | Save repo into catalog; optional archive | high–**critical** | **None** | none | None | none | **requireAdmin** + CSRF |
| Archive delete | via maintenance storage/cleanup only | delete artifacts/rows | **critical** | Admin (maintenance) | admin | None | global | confirm + audit |
| Restore | CLI `npm run restore` | Restore from backup | **critical** | host access | operator | N/A | N/A | keep CLI-only or admin POST with confirm |

### Export / ingestion adjacent public mutations

| Route | Method | Action | Destructive impact | Auth | Authz | CSRF | Ownership | Recommended protection |
|---|---|---|---|---|---|---|---|---|
| `/api/export/bulk` | **GET** | Start bulk export job | high (CPU/disk + data exfil) | **None** | none | **GET+cookie risk** | none | **POST + requireAdmin** (or signed job) |
| `/api/export/bulk/[jobId]/download` | GET | Download export | high (exfil) | **None** | none | link share risk | none | admin or unguessable + authz |
| `/api/export/names` | GET | Export all names | medium | **None** | none | none | none | requireAdmin |
| `/api/repos/[id]/archive-story/regenerate` | POST | Regenerate story | low | **None** | none | None | none | requireAdmin or leave public read-only regen with rate limit |

### Intelligence review / classification override

| Route | Method | Action | Destructive impact | Auth | Authz | CSRF | Ownership | Recommended protection |
|---|---|---|---|---|---|---|---|---|
| `/api/admin/intelligence/review` | POST | Save review / classification override | medium | Admin | admin | None | global | CSRF + audit (`reviewedBy` already `'admin'`) |
| `/api/discovery/emerging/[key]` | POST `set-status`/`merge`/`exclude` | Mutate emerging topics | medium (global intel) | **None** | none | None | none | **requireAdmin** + CSRF |

### Ratings / favorites / collections / hide

| Route | Method | Action | Destructive impact | Auth | Authz | CSRF | Ownership | Recommended protection |
|---|---|---|---|---|---|---|---|---|
| `/api/websites/[domain]/rating` | POST/DELETE | Upsert/soft-delete rating | low | Anonymous owner cookie | owner-scoped | None | `collectionOwner` | keep owner scope; optional Origin check; rate-limit |
| `/api/websites/[domain]/favorite` | PUT/DELETE | Website favorite | low | Anonymous | owner-scoped | None | owner | same |
| `/api/websites/[domain]/hide` | PUT/DELETE | Hide website for owner | low | Anonymous | owner-scoped | None | owner | same |
| `/api/collections/[kind]/repositories/[repoId]` | PUT/DELETE | Repo favorites / watch later | low | Anonymous | owner-scoped | None | owner | same |
| `/api/collections/memberships` | POST | Batch membership **read** | none | Anonymous | owner-scoped | None | owner | ok |

---

## Assessment vs prior review

| Prior statement | Current |
|---|---|
| All pages unauthenticated | **False** for `/admin*` and `/api/admin*` (login required) |
| All destructive admin endpoints public | **False** for `/api/admin/*` path prefix; **true** for several non-`/api/admin` mutations |
| No session model | **False** — HMAC admin cookie exists |
| No CSRF | **Still true** |
| No roles | **Partially true** — only admin vs anonymous |

## Smallest safe access-control model

Do **not** build a social-account system for the current operator app.

1. **Single-operator admin**
   - Require non-default `ADMIN_PASSWORD` and dedicated `ADMIN_SESSION_SECRET` in production (fail closed).
   - Keep signed `gha_admin` cookie; 7-day or shorter idle timeout.
2. **Central `requireAdmin(locals)`**
   - Use for every global/destructive/pipeline/export mutation, not only `/api/admin/*`.
3. **Origin / CSRF validation**
   - Reject state-changing requests with missing/mismatched `Origin` (and/or `Sec-Fetch-Site` not `same-origin`/`none` for navigations).
4. **Stop GET mutations**
   - Bulk export start → POST; logout → POST.
5. **Anonymous personal curation stays cookie-scoped**
   - Ratings/favorites/hide/collections remain visitor-local; no admin required.
6. **Mutation audit log (minimal)**
   - Append-only table or structured log: actor (`admin` / `anon:<id>`), route, action, params summary, timestamp, result.
7. **Destructive confirm**
   - For purge/storage deletes: require `confirm: true` + recent backup id or explicit `I_UNDERSTAND` token.

Out of scope for the minimal model: OAuth, multi-tenant RBAC, public user profiles, email verification.
