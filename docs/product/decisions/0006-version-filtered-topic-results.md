# Version-filtered topic results

## Problem

After emerging-topic detection changed to version 2, stale version 1 rows could still appear as if they were current intelligence.

## Decision

Filter emerging topic details and materialized discovery payloads by the active detection version.

## Why

Old persisted rows should never masquerade as current detector output. A version boundary is safer than trying to reinterpret old `evidence_json`.

## Alternatives Rejected

- Reinterpret v1 rows with v2 UI logic.
- Show both versions without clear distinction.
- Delete old rows from the database.

## Affected Systems

- `getEmergingTopicDetail`
- `getMaterializedDiscoveryLanding`
- Emerging topic homepage cards
- Emerging topic detail pages

## Commit

6f9aa54

## Date

2026-07-31

## Follow-up Work

- Surface production/source detection-version mismatches in diagnostics.
