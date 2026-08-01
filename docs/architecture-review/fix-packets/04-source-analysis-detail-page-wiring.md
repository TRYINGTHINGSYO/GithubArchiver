# Fix packet 04 — Source analysis detail page wiring

## Problem

Repository detail SSR loader always sets `sourceAnalysis: null`, so source-derived security/technology intelligence on the detail page stays disconnected even though source analysis APIs/helpers exist.

## Evidence

- `src/lib/server/repos.ts` (~1630): `const sourceAnalysis: SourceAnalysis | null = null;`
- Detail UI: `src/routes/repo/[owner]/[repo]/+page.svelte` hydrates `data.sourceAnalysis` and can fetch on section open
- File browser endpoints analyze snapshots: `src/routes/api/repo/[owner]/[repo]/files/*`
- `tsc`: `security_files` property on type `never`

## Affected files

- `src/lib/server/repos.ts` (`getRepoWithSnapshots` / detail DTO builder)
- Source analysis module(s) under `src/lib/server/source-archive.ts` (and related)
- Possibly `src/routes/repo/[owner]/[repo]/+page.server.ts`
- Tests for repo detail / source analysis

## User impact

Security files, language breakdown, and technology insights from the archived source do not appear on first paint; users may assume analysis is unavailable.

## Severity

**P1**

## Exact desired behavior

1. When a latest source snapshot exists and analysis can be loaded cheaply enough for SSR (or from a persisted analysis cache), `sourceAnalysis` is populated.
2. If analysis is expensive, SSR may return a structured “available but deferred” object — **not** hard-coded `null` that types as `never` — and the existing client fetch path remains.
3. Reanalyze action updates the same DTO shape the page already understands.
4. No fabricated analysis when no source snapshot exists.

## Implementation constraints

- Bound CPU/memory (do not gunzip huge archives synchronously on every detail request without cache)
- Prefer persisted analysis artifact if one already exists; otherwise lazy + cache
- Do not block packet 02’s compare-readme import fix on this work, but remove the `never` typing as part of wiring

## Schema changes

Optional: persist source analysis JSON keyed by `source_snapshot_id` if not already stored. Only add if required for SSR performance.

## API changes

Keep `/files` and reanalyze endpoints; ensure detail loader uses the same analysis type.

## UI changes

Detail “Source intelligence” section shows real data on load when snapshot exists; clear empty copy when not.

## Migration and rollback

- Additive analysis cache table only if needed
- Rollback: return to lazy client fetch, but do not reintroduce hard-coded null without a typed deferred state

## Tests

- Repo with source snapshot → detail DTO has non-null analysis (or explicit deferred state with `available: true`)
- Repo without source → null/absent analysis, no throw
- Reanalyze updates analysis used by detail

## Explicit out-of-scope

- Recurring archive refresh (packet 05)
- UI redesign of repo page
- LLM summarization

## Acceptance criteria

- [ ] No hard-coded `sourceAnalysis = null` in the success path when analysis is available
- [ ] `tsc` no longer reports `security_files` on `never`
- [ ] Detail page shows source-derived tech/security when snapshot exists
- [ ] Performance guard documented (cache or deferred)
