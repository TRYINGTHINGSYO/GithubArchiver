# Fix packet 01 — Admin auth and mutation security

## Problem

Admin UI/API are gated, but CSRF/origin checks are absent, the default password is weak, several high-impact mutations remain public, and destructive actions lack confirm/audit controls.

## Evidence

- `src/lib/server/auth.ts` — default `ADMIN_PASSWORD` `'GitHub'`; session secret falls back to password
- `src/hooks.server.ts` — gates only `/admin*` and `/api/admin/*`
- Ungated: `src/routes/api/repo/save/+server.ts`, `src/routes/api/discovery/emerging/[key]/+server.ts` POST, `src/routes/api/export/bulk/+server.ts` GET, archive-story regenerate POST
- No Origin/CSRF checks under `src/`
- Inventory: `docs/architecture-review/mutation-inventory.md`

## Affected files

- `src/lib/server/auth.ts`
- `src/hooks.server.ts` (or new `src/lib/server/require-admin.ts`, `csrf.ts`)
- Admin + public mutation route handlers listed in inventory
- `src/routes/login/+page.server.ts`, `src/routes/logout/+server.ts`
- Production start/config docs for required secrets
- New tests under `tests/`

## User impact

Unauthenticated or CSRF-triggered archive/export/cleanup/emerging-review actions can destroy data, exhaust storage/GitHub quota, or exfiltrate catalog exports.

## Severity

**P0**

## Exact desired behavior

1. Production refuses to boot (or refuses admin login) without strong `ADMIN_PASSWORD` and distinct `ADMIN_SESSION_SECRET`.
2. Every global/destructive/pipeline/export mutation requires admin session.
3. State-changing requests validate same-origin (`Origin` / `Sec-Fetch-Site`).
4. Bulk export start and logout are POST (no GET side effects).
5. Destructive purge/storage deletes require explicit confirmation payload.
6. Mutations append a minimal audit record.
7. Anonymous rating/favorite/collection/hide remain owner-cookie scoped without admin.

## Implementation constraints

- Single-operator model only — no OAuth/social accounts
- Prefer small helpers over a new auth framework
- Do not break anonymous website curation APIs
- Keep restore CLI-only unless adding a carefully confirmed admin restore later

## Schema changes

Optional minimal:

```sql
CREATE TABLE IF NOT EXISTS mutation_audit (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  route TEXT NOT NULL,
  action TEXT NOT NULL,
  detail_json TEXT,
  ok INTEGER NOT NULL,
  ip TEXT
);
```

If deferred, structured server logs are acceptable for v1 with a follow-up migration.

## API changes

- `GET /api/export/bulk` start → `POST /api/export/bulk` (admin)
- Emerging topic POST → admin only
- `/api/repo/save` → admin only
- Export downloads → admin only (or signed short-lived job token)
- Logout → POST
- Destructive maintenance bodies require `confirm: true` (and optionally `confirm_token`)

## UI changes

- Admin storage/cleanup buttons send confirm flag
- Login page shows error if server rejects weak/missing prod secrets
- No new multi-user account UI

## Migration and rollback

- Audit table additive — safe forward
- Rollback: feature-flag Origin checks if a legitimate cross-origin admin tooling path exists (should not in this app)

## Tests

- Unauthenticated requests to newly gated routes → 401
- Admin session succeeds
- Missing/mismatched Origin → 403 on POST mutations
- GET bulk export start no longer mutates
- Default password rejected when `NODE_ENV=production`
- Anonymous favorite/rating still works without admin

## Explicit out-of-scope

- Social login, roles beyond admin/anonymous
- Website moderation product
- Worker process isolation (packet 06)
- Full schema inventory rewrite

## Acceptance criteria

- [ ] No unauthenticated path can start archive, backup, cleanup purge, bulk export, repo save, or emerging merge/exclude/status
- [ ] CSRF/origin check covers admin JSON mutations
- [ ] Production requires real secrets
- [ ] Mutation inventory updated to “protected”
- [ ] Vitest coverage for gate + Origin + anonymous curation unchanged
