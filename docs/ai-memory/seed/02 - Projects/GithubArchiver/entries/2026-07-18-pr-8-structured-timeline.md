---
date: 2026-07-18
pr: 8
commit: null
area:
  - memory
type: architecture
status: open
supersedes: pr-7
title: Structured checkpoint metadata and generated project timeline
---

# PR #8 — Structured memory timeline

Every durable checkpoint is an `entries/*.md` file with YAML frontmatter (`date`, `pr`, `commit`, `area`, `type`, `status`, …).

`npm run memory:timeline` regenerates:

- `Timeline.md`
- `Architecture Decisions.md`
- `Production Incidents.md`
- `Migrations.md`
- `PR Timeline.md`
- `Open Technical Debt.md`

This lets agents answer “what changed in the daemon?” / “show incidents” by scanning indexes instead of relying only on semantic search.
