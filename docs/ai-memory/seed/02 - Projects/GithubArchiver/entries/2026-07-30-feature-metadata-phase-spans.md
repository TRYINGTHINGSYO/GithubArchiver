---
schema: 1
id: feature-metadata-phase-spans
date: 2026-07-30
area:
  - enrichment
  - observability
type: feature
status: open
confidence: confirmed
durability: permanent
relationships:
  - type: caused-by
    id: research-enrichment-throughput-ceiling
  - type: references
    id: decision-enrich-stage-timings
  - type: related
    id: migration-038-archive-hour-metrics
title: Instrument metadata into queue/HTTP/DB spans before concurrency changes
---

# Instrument metadata into queue/HTTP/DB spans before concurrency changes

Enrichment metadata stage showed ~11s p50 while a plain GitHub fetch from the same environment was 254–372 ms. Do not raise concurrency until the aggregate is split.

## Spans (persisted under `stage_percentiles_json.metadataDetail`)

- `queueWaitMs` — mapPool slot wait before `enrichRepo` starts
- `rateLimitWaitMs` — inline pacing sleep (currently 0; cycle yields instead)
- `httpConnectTtfbMs` / `bodyReadMs` / `parseMs` — from `ghFetch`
- `dbWriteMs` — `saveEnrichment` + `setEnrichmentLevel` only
- `postprocessMs` — rename/archive apply + enrichment mapping before that write
- `operationTotalMs` = rateLimit + HTTP + parse + postprocess + dbWrite (**excludes** queueWait)
- `endToEndTotalMs` = queueWait + operationTotal

Every percentile pair carries `n` (sample count). `metadataDetail.sampleCount` is the span-sample denominator.

Legacy `avg_metadata_ms` / `metadata` percentiles remain wall-clock of `fetchRepoMetadata` only — reconcile against HTTP span sum + any event-loop gap, not against `endToEndTotal`.

## Sequence

1. Deploy after ingest clean window observations continue
2. Collect enrich cycles with `metadataDetail` populated
3. Attribute the 11s (queue vs rate-limit vs HTTP vs DB vs event-loop starvation visible as inflated TTFB)
4. Only then change concurrency
5. Readiness-cache / homepage 6.4s TTL miss stays behind this unless user traffic forces it

## Tests

`tests/metadata-phase-spans.test.ts`, extended `tests/high-throughput-enrichment.test.ts`.
`npm run measure:enrichment` prints metadata phase p50/p95 when present.
