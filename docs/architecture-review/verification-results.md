# Verification results (current branch)

- Reviewed code branch: `origin/cursor/intelligence-discovery-redesign-1514` (PR #28)
- Reviewed code commit: `2b77ed95201b0c395b445bdbb475966bedcc83bc`
- Node: `v22.14.0`
- npm: `10.9.7`
- Date: 2026-08-01

Commands were run in this environment after `npm install`. Exit codes below are exact.

---

## 1. Dependency installation

| Field | Value |
|---|---|
| Command | `npm install` |
| Exit code | **0** |
| Relevant output | `added 196 packages, and audited 197 packages in 3s` |
| Notes | Initial workspace had no `node_modules`. npm reported 5 vulnerabilities (3 low, 2 high) and deprecated `prebuild-install@7.1.3`. |
| Release-blocking? | **No** (install succeeded). Audit findings are follow-up, not a failed install. |

---

## 2. `npm run build`

| Field | Value |
|---|---|
| Command | `npm run build` |
| Exit code | **0** |
| Relevant output | `✓ built in 5.06s` then `Using @sveltejs/adapter-node` / `✔ done` |
| Affected files | Build artifacts under `.svelte-kit/` / `build/` |
| Release-blocking? | **No** |

---

## 3. `npx tsc --noEmit`

| Field | Value |
|---|---|
| Command | `npx tsc --noEmit` |
| Exit code | **2** |
| Error count | **63** `error TS*` lines |
| Release-blocking? | **Yes for type-gated release / CI**; **partially yes for runtime** on specific files below. Vite build does **not** fail. |

### Runtime-relevant failures

| File | Error | Impact |
|---|---|---|
| `src/routes/repo/[owner]/[repo]/compare-readme/+page.server.ts` | `TS2304` cannot find `renderMarkdownSafe` (×2), `diffLines` (×1) | **Runtime ReferenceError** when loading compare page |
| `src/lib/server/repos.ts` | `TS2339` `security_files` on type `never` (from hardcoded `sourceAnalysis = null`) | Confirms disconnected SSR source analysis |

### High-volume typing debt (not proven runtime bugs)

| Area | Pattern |
|---|---|
| `src/lib/server/workers/*.ts`, `job-runner.ts`, `background-daemon.ts`, `api/admin/maintenance/+server.ts` | Result objects not assignable to `Record<string, unknown>` |
| `src/lib/server/github-conn-trace.ts` | `dns.LookupCallback` missing in Node types |
| `src/lib/server/snapshots.ts`, `source-zip.ts` | `ArchiveSnapshotRow` not exported from db/archive |
| `tests/archive-hour-metrics.test.ts`, `tests/source-zip.test.ts` | Test fixture typing mismatches |

Full log captured at `/tmp/verify-tsc.log` during the review run.

---

## 4. `npm test`

| Field | Value |
|---|---|
| Command | `npm test` (`vitest run`) |
| Exit code | **0** |
| Relevant output | `Test Files  67 passed (67)` / `Tests  361 passed (361)` / `Duration  13.37s` |
| Release-blocking? | **No** (suite green). Note: suite does **not** currently fail on missing compare-readme imports or empty-volume cluster defect. |

---

## 5. Migration tests

| Field | Value |
|---|---|
| Command | `npx vitest run tests/collections-migration.test.ts tests/daemon-migration.test.ts tests/migration-042-github-id.test.ts tests/cluster-migration.test.ts tests/archive-story-migration.test.ts` |
| Exit code | **0** |
| Relevant output | `Test Files  5 passed (5)` / `Tests  9 passed (9)` |
| Release-blocking? | **No** |

---

## 6. Production migration tests

| Field | Value |
|---|---|
| Command | `npx vitest run tests/production-migrate.test.ts` |
| Exit code | **0** |
| Relevant output | `Test Files  1 passed (1)` / `Tests  2 passed (2)` |
| Release-blocking? | **No** |

---

## 7. Website discovery tests

| Field | Value |
|---|---|
| Command | `npx vitest run tests/website-discovery.test.ts` |
| Exit code | **0** |
| Relevant output | `Test Files  1 passed (1)` / `Tests  6 passed (6)` |
| Release-blocking? | **No** |

---

## 8. Website curation tests

| Field | Value |
|---|---|
| Command | `npx vitest run tests/website-curation.test.ts` |
| Exit code | **0** |
| Relevant output | `Test Files  1 passed (1)` / `Tests  13 passed (13)` |
| Release-blocking? | **No** |

---

## 9. Collection tests

| Field | Value |
|---|---|
| Command | `npx vitest run tests/collections.test.ts tests/collections-api.test.ts tests/collections-migration.test.ts tests/collection-owner.test.ts tests/collection-membership-client.test.ts` |
| Exit code | **0** |
| Relevant output | `Test Files  5 passed (5)` / `Tests  12 passed (12)` |
| Release-blocking? | **No** |

---

## Summary matrix

| Command | Exit | Release-blocking? |
|---|---:|---|
| `npm install` | 0 | No |
| `npm run build` | 0 | No |
| `npx tsc --noEmit` | **2** | **Yes** (if typecheck is a release gate); runtime subset is P1 regardless |
| `npm test` | 0 | No |
| Migration tests | 0 | No |
| Production migration tests | 0 | No |
| Website discovery tests | 0 | No |
| Website curation tests | 0 | No |
| Collection tests | 0 | No |

**Do not treat the green Vite build or green vitest run as evidence that TypeScript/runtime compare-readme and sourceAnalysis defects are fixed.**
