---
schema: 1
id: incident-enrichment-hourly-bottleneck
date: 2026-07-18
pr: 18
commit: 3792bf9
area:
  - enrichment
  - daemon
  - throughput
type: incident
status: open
confidence: confirmed
durability: permanent
supersedes: null
relationships:
  - type: related
    id: incident-backlog-sleep-tiers
  - type: related
    id: debt-github-token
related:
  - incident-backlog-sleep-tiers
  - debt-github-token
title: Enrichment must be continuous concurrent queue not hourly trickle
migration: null
---

# Incident — Enrichment throughput bottleneck

## Symptom

Dashboard showed ~739k indexed, ~3.3k analyzed (0.4%), ~671k waiting, “this run: 13”, worker last ran ~1 hour ago. At 13/hour the backlog would take years.

## Root cause (architecture)

Discovery can run on an hourly cadence. Enrichment was still effectively gated by short cycles + 30–60s daemon sleeps between planner turns, so the worker looked idle for long stretches. “Worker last ran” on the homepage reflected **discovery** `lastIngestionAt`, not enrichment — masking the real enrich rate.

Queue/claim/concurrency already existed (high-throughput architecture); the missing piece was **continuous drain** + honest throughput UX.

## Fix direction

1. Enrich **burst cycles** inside the daemon enrich action (`ENRICH_BURST_CYCLES`, default 8).
2. Near-continuous sleep while unenriched backlog remains (`ENRICH_BACKLOG_SLEEP_MS`, default 2s).
3. Defaults: concurrency **8**, batch **100**, longer cycle budget / request budget.
4. Claimable vs deferred backlog split — deferred long-tail stays metadata-only.
5. Homepage/admin show **repos/minute**, last hour, concurrency, ETA on claimable queue, enrichment last ran.

## Operating rule

> Discovery may run hourly. Enrichment cannot run hourly. Enrichment must be a continuous, concurrent, priority-driven queue.

Without a real `GITHUB_TOKEN`, GitHub’s unauthenticated 60 req/hr cap still dominates — see open debt.
