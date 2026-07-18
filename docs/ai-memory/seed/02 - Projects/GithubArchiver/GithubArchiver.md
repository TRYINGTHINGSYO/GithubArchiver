---
status: active
project: githubarchiver
type: index
---

# GithubArchiver

## Purpose

GithubArchive+ is an evidence-first GitHub repository intelligence platform.
It ingests repository creation signals, enriches repositories, classifies them, assigns clusters, calculates Interesting Scores, generates Archive Stories, and detects emerging themes.

## Memory operating system

```text
entries/   append-only event log (source of truth)
    ↓
npm run memory:timeline
    ↓
┌───────────────────┬────────────────────┬──────────────────┐
│ Timeline.md       │ Current Status.md  │ Project Digest.md│
│ (chronological)   │ (living summary)   │ (AI one-pager)   │
└───────────────────┴────────────────────┴──────────────────┘
         + Knowledge Graph.md + indexes/<type>.md
```

**Load order for agents**

1. [[Project Digest]] — if only one file fits
2. [[Current Status]] — open work / debt / recent merges
3. `npm run memory:query -- "<topic>" --budget 6000` — multi-stage ranked context
4. [[Timeline]] / [[Knowledge Graph]] / `index.json` — deeper history
5. [[Decisions]] / [[Architecture]] — enduring principles (prefer `durability: permanent`)

## Current Operating Principles

- GH Archive is the primary discovery source.
- Search is fallback behavior, not the default.
- Enrichment backlog does not pause ingestion.
- UI status must distinguish current activity, progress, and discovery.
- Stale runtime rows must be reconciled after process restarts.
- Memory summaries are generated; entry facts are append-only.

## Related repo paths

- Cursor rules: `.cursor/rules/`
- Seed: `docs/ai-memory/seed/02 - Projects/GithubArchiver/`
