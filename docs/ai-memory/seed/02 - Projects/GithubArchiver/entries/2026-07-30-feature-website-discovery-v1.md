---
id: feature-website-discovery-v1
date: 2026-07-30
area:
  - websites
  - discovery
  - daemon
type: feature
status: done
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: references
    id: migration-037-website-discovery
  - type: related
    id: bugfix-ingest-fetch-timeout
  - type: related
    id: feature-ingest-timeout-hour-backoff
title: Website discovery v1 — CT poll + verify + Websites feed
---

## Decisions locked

1. CT via **crt.sh poll** (rotating TLD allowlist), not live tail
2. Zone feed optional (`WEBSITE_ZONE_FEED_URL`); CZDS/ccTLD deferred
3. Intake filter (`WEBSITE_CT_TLDS`) + liveness gate for public feed

## Hardening

- All fetches use `fetchWithTimeout` / AbortSignal
- Verify failures use `website_verify_backoff` (15m→…×8)
- Job types `website_discover_ct|zone|verify` on `job_runs`; orphan reconcile is type-agnostic (covered)
- Cadence via `daemon-cadence` (not planner race)

## Surfaces

- `/websites` reverse-chron live feed + nav link
- Schema 37: `candidate_domains`, `website_verify_backoff`, `website_pipeline_state`
