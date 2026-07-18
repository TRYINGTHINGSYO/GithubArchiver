---
date: 2026-07-18
pr: 7
commit: 5cc586d
area:
  - memory
type: architecture
status: open
supersedes: null
title: Cursor Project Rules + AI memory seed vault
---

# PR #7 — Cursor AI memory bootstrapping

- `.cursor/rules/`: memory-system, githubarchiver-context, session-checkpoint
- Seed vault under `docs/ai-memory/seed/` for copy into `C:\AI-Memory`
- Portable vault resolution: `AI_MEMORY_VAULT` → `C:\AI-Memory` → `$HOME/AI-Memory`
- Durable checkpoints only — no forced daily-note diaries
