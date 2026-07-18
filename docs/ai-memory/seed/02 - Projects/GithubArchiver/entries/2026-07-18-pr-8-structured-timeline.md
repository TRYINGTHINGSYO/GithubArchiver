---
id: feature-structured-timeline
date: 2026-07-18
pr: 8
commit: feda976
area:
  - memory
type: feature
status: open
confidence: confirmed
supersedes: feature-cursor-memory-rules
related:
  - pr-7
  - pr-9
  - memory
title: Structured checkpoint metadata and generated project timeline
migration: null
---

# PR #8 — Structured memory timeline

Append-only `entries/*.md` with YAML frontmatter become the event log. `npm run memory:timeline` regenerates chronological and categorical views. Raw facts stay immutable; summaries are derived.
