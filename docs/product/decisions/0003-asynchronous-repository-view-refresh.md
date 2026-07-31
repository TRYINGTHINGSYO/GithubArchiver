# Asynchronous repository-view refresh

## Problem

Repository detail pages could block on live GitHub refreshes, making stale records feel slow and coupling page latency to GitHub response time.

## Decision

Render stored repository intelligence immediately and queue bounded stale metadata refresh work in the background.

## Why

Stale repository pages should load nearly as fast as fresh pages. The archive should remain useful even when live GitHub calls are slow.

## Alternatives Rejected

- Block repository page rendering until GitHub refresh completes.
- Disable refresh from repository views entirely.

## Affected Systems

- `/repo/[owner]/[repo]`
- Refresh queue
- Server-Timing
- Navigation progress indicator

## Commit

9603a95

## Date

2026-07-31

## Follow-up Work

- Persist route timing samples.
- Monitor refresh dedupe hit rate and queue failures.
