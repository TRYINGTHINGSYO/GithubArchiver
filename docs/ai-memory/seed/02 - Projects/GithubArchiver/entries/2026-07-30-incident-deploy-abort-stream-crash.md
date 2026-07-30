---
id: incident-deploy-abort-stream-crash
date: 2026-07-30
area:
  - ingest
  - gharchive
  - deploy
type: incident
status: done
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: caused-by
    id: bugfix-ingest-fetch-timeout
  - type: related
    id: incident-daemon-ingest-hang
title: Mid-stream GH Archive abort crashed Node and failed Railway deploy
---

## What

Railway deploy of `19867ca` built and started, then the process crashed:

`Unhandled 'error' event` / `DOMException [AbortError]: This operation was aborted` on a Readable from `Readable.fromWeb(res.body)` → gunzip pipe when `AbortController` fired mid-body.

## Why

`bugfix-ingest-fetch-timeout` correctly aborted hung hours, but `nodeStream.pipe(gunzip)` had no error listeners covering the abort race. Unhandled Readable `error` kills Node → deploy failed (0/1 running).

## Fix

`readHourStream` now takes the hour `AbortSignal`, attaches error listeners before pipe, destroys both ends on abort, and converts abort into `GhArchiveTimeoutError` without crashing. Regression test: mid-stream abort.

## Remaining

Watch next deploy; 30s default may still fail many hours from EU (logged as failed, not crash) — tune `GH_ARCHIVE_FETCH_TIMEOUT_MS` if catch-up is too noisy.
