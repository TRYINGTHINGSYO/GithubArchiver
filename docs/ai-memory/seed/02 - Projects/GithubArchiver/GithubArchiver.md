---
status: active
project: githubarchiver
type: index
---

# GithubArchiver

## Purpose

GithubArchive+ is an evidence-first GitHub repository intelligence platform.
It ingests repository creation signals, enriches repositories, classifies them, assigns clusters, calculates Interesting Scores, generates Archive Stories, and detects emerging themes.

## Current Architecture

- SvelteKit application
- SQLite with numbered migrations
- GH Archive ingestion
- GitHub Search fallback
- Background daemon
- Enrichment pipeline
- Clustering and emerging-topic analysis
- Railway production deploy (auto from `main`)

## Current Operating Principles

- GH Archive is the primary discovery source.
- Search is fallback behavior, not the default.
- Enrichment backlog does not pause ingestion.
- UI status must distinguish current activity, progress, and discovery.
- Stale runtime rows must be reconciled after process restarts.

## Memory map (project operating system)

```text
GithubArchiver
│
├── Architecture Decisions   ← generated
├── Production Incidents     ← generated
├── Migrations               ← generated
├── PR Timeline              ← generated
├── Open Technical Debt      ← generated
├── Current Status           ← hand-maintained live summary
├── Timeline                 ← generated master index
├── Architecture.md          ← enduring subsystem notes
├── Decisions.md             ← locked principles
└── entries/                 ← structured checkpoints (source of truth)
```

- Start with [[Current Status]] and [[Timeline]]
- Deep principles: [[Decisions]], [[Architecture]]
- New durable fact → new `entries/*.md` + `npm run memory:timeline`

## Related repo paths

- Cursor rules: `.cursor/rules/`
- Seed copy in repo: `docs/ai-memory/seed/02 - Projects/GithubArchiver/`
