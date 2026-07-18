---
id: debt-github-token
date: 2026-07-18
pr: null
commit: null
area:
  - ops
  - enrichment
  - search
type: technical-debt
status: open-debt
supersedes: null
related:
  - search-fallback
  - enrichment
title: Production Railway needs a real GITHUB_TOKEN
migration: null
---

# Tech debt — GITHUB_TOKEN on Railway

API-backed enrichment and Search fallback require a real `GITHUB_TOKEN` in the Railway environment. This is ops configuration, not a code defect. Track until verified present and quota-healthy in production.
