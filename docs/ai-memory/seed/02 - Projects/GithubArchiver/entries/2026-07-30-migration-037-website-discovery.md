---
id: migration-037-website-discovery
date: 2026-07-30
area:
  - websites
  - schema
type: migration
status: verified
confidence: confirmed
durability: permanent
schema: 1
relationships:
  - type: implemented-by
    id: feature-website-discovery-v1
title: Schema 37 — candidate_domains + website verify backoff
---

Adds `candidate_domains`, `website_verify_backoff`, and `website_pipeline_state` for the website discovery pipeline.
