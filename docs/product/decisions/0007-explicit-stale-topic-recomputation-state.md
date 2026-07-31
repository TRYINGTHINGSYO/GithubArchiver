# Explicit stale-topic recomputation state

## Problem

When a direct emerging-topic URL had only older detection-version rows, a generic 404 hid the fact that the topic existed but was awaiting recomputation.

## Decision

Return a dedicated stale-topic page explaining that the old model result exists and is awaiting a fresh current-version detection run.

## Why

This is more honest and useful than pretending the topic never existed, while still avoiding stale v1 scoring as current intelligence.

## Alternatives Rejected

- Generic 404 for stale topics.
- Serve stale v1 details with a small warning.

## Affected Systems

- `/discover/emerging/[key]`
- `getStaleEmergingTopicSummary`
- Emerging topic detail load state

## Commit

da9e821

## Date

2026-07-31

## Follow-up Work

- Add admin-only recompute action for stale topics.
