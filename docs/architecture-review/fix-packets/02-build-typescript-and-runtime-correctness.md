# Fix packet 02 — Build, TypeScript, and runtime correctness

## Problem

`npm run build` and `npm test` pass, but `npx tsc --noEmit` fails with 63 errors. At least one set is runtime-breaking (README compare missing imports); `sourceAnalysis` null also surfaces as `never` typing.

## Evidence

- Verification: `docs/architecture-review/verification-results.md`
- `compare-readme/+page.server.ts` calls `renderMarkdownSafe` / `diffLines` without imports
- Symbols exist in `src/lib/server/markdown.ts`
- `src/lib/server/repos.ts` hardcodes `const sourceAnalysis: SourceAnalysis | null = null` → `security_files` on `never`
- Many workers pass typed results into `Record<string, unknown>` sinks

## Affected files

- `src/routes/repo/[owner]/[repo]/compare-readme/+page.server.ts`
- `src/lib/server/markdown.ts` (already correct; import target)
- `src/lib/server/repos.ts` (typing + wiring overlap with packet 04)
- Worker/job typing: `src/lib/server/job-runner.ts`, `background-daemon.ts`, `workers/*`, `api/admin/maintenance/+server.ts`
- Export/type fixes: `src/lib/server/db/archive.ts`, `snapshots.ts`, `source-zip.ts`, `github-conn-trace.ts`
- Test fixtures: `tests/source-zip.test.ts`, `tests/archive-hour-metrics.test.ts`
- CI config if typecheck not gated

## User impact

- README compare page crashes at runtime
- Typecheck cannot be a reliable release gate
- Real bugs can hide behind Vite’s transpile-only build

## Severity

**P1** (runtime compare-readme + sourceAnalysis typing); remaining Record<> noise is **P2** but should ship in the same correctness PR if cheap.

## Exact desired behavior

1. `npx tsc --noEmit` exits 0 on the release branch.
2. README compare page renders markdown + diff using imported helpers.
3. CI runs `tsc --noEmit` (or `npm run check`) on PRs.
4. No new `as any` silencers that hide the sourceAnalysis disconnect.

## Implementation constraints

- Prefer correct types (`unknown` / generics) over casting everything to `Record<string, unknown>`
- Do not “fix” sourceAnalysis by fabricating data — wire real analysis in packet 04; this packet may only unblock types if 04 is separate
- Keep build adapter-node behavior unchanged

## Schema changes

None.

## API changes

None required (compare page is SSR).

## UI changes

None beyond compare page working.

## Migration and rollback

N/A.

## Tests

- Unit/SSR test or route test that loads compare-readme with two README snapshots and asserts HTML/diff arrays
- `npx tsc --noEmit` in CI
- Existing `npm test` remains green

## Explicit out-of-scope

- Semantic search
- Worker process split
- Auth/CSRF (packet 01)
- Intelligence model quality

## Acceptance criteria

- [ ] `npx tsc --noEmit` exit 0
- [ ] Compare-readme no longer throws ReferenceError
- [ ] CI typecheck documented/enabled
- [ ] No regression in `npm run build` / `npm test`
