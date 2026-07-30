---
schema: 1
id: bugfix-dashboard-trust-semantics
date: 2026-07-30
area:
  - observability
  - search-fallback
  - enrichment
  - emerging-topics
type: bugfix
status: verified
confidence: confirmed
durability: permanent
relationships:
  - type: supersedes
    id: incident-search-fallback-stale
  - type: related
    id: incident-freshness-stall
  - type: validates
    id: test-readiness-growth-gate
title: Three dashboard fields asserted things the data did not support
migration: null
---

# Dashboard trust semantics (Phase 0)

Audited the live homepage / readiness API against the production database. Three
displayed values were wrong or misleading in ways that made the whole dashboard
untrustworthy. None were subsystem failures — all three were presentation defects.

## 1. `Coverage 100%` while the corpus was 3.9% enriched

`+page.svelte` computed a second, independent coverage number:

```
enrichedTotal / (enrichedTotal + claimableBacklog)
```

`claimableBacklog` is the *momentarily claimable* queue, not the backlog. When the
queue drained (claimable = 0) the denominator collapsed to the numerator and the
field read `100%`. Live values at audit time: 46,118 enriched, 1,123,066 unenriched,
claimable 0 → displayed `100%`.

`+page.server.ts` already computed the correct figure as `analyzedCoveragePercent`
(3.9%) for the snapshot block, so both numbers rendered on the same page. This is the
`3.7% vs 99.3%` clash first seen in `incident-freshness-stall`.

Fix: coverage is now corpus-relative (`readiness.enrichedRepos / readiness.totalRepos`),
and the top-line `Waiting` shows total unenriched. Claimable vs deferred remain broken
out separately under Throughput, where the queue-relative view belongs.

## 2. `Search fallback: No` — closes incident-search-fallback-stale

Not a stale flag and not a disabled subsystem. `isSearchFallbackActive()` is a
*momentary activity* predicate — true only while a Search API pass is executing — but
it rendered as `Yes`/`No`, which reads as a capability that is switched off. `No` is
the correct and overwhelmingly common state, because `search_gap` only runs when the
current hour yielded no GH Archive repo births.

Fix: renders `Running now` / `Idle`. The lifetime `Historical Search-fallback
discoveries` count next to it remains the real health signal. No behaviour change.

## 3. Readiness claimed ready while growth was suppressed

`/api/status/readiness` returned `emergingDetectionReady: true, readinessReasons: []`
while the latest detection run reported `growthSuppressedReason:
"insufficient-hour-coverage"` (current window 50/168 hours ingested = 30%, gate is
`MIN_COMPARABLE_HOUR_COVERAGE = 0.9`). Detection genuinely can run; its core signal
— week-over-week growth — cannot be computed. Readiness had no visibility into that
gate, so the operator surface reported unqualified success.

Fix: extracted `getWindowHourCoverage()` from `getDetectionWindowMetadata()` so
detection and readiness share one implementation, and readiness now exposes
`growthComparisonReady` plus hour counts and emits an explicit reason. Deliberately
did **not** flip `emergingDetectionReady` to false — detection running and growth
being comparable are different claims and should stay separate.

## Verification

`tests/readiness-growth-gate.test.ts` covers the suppressed gate, the cleared gate,
and that both callers share the hour-coverage implementation. Full suite green
(248 → 251 tests), production build clean.
