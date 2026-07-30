---
id: bugfix-deploy-healthcheck-race
date: 2026-07-30
area:
  - deploy
  - daemon
type: bugfix
status: verified
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: caused-by
    id: feature-ingest-timeout-hour-backoff
  - type: related
    id: incident-deploy-abort-stream-crash
title: Railway healthcheck on / raced daemon ingest — deploy failed, site 502
---

## What

Deploy `ac9dccc` migrated to schema 36, started listening, ran ingest/backoff correctly, then Railway **Stopping Container** / FAILED. Prod left at 502 (0/1). Healthcheck was `GET /` (heavy homepage + boots daemon).

## Fix

- `healthcheckPath = /api/health` (plain `ok`, no SSR)
- Delay daemon reconcile+start by `BACKGROUND_WORKER_DELAY_MS` (default 15s) after first request
---
