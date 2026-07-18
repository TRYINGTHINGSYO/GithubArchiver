---
status: active
project: githubarchiver
type: index
---

# GithubArchiver

## Purpose

GithubArchive+ is an evidence-first GitHub repository intelligence platform.
It ingests repository creation signals, enriches repositories, classifies them, assigns clusters, calculates Interesting Scores, generates Archive Stories, and detects emerging themes.

## Knowledge operating system

```text
Append-only entries → Graph + index.json → Generated views
                              ↓
              Read-only retrieval (query / eval)
```

Retrieval never writes facts back into the vault.

**Load order for agents**

1. [[Project Digest]] — if only one file fits
2. [[Current Status]] — open work / debt / recent merges
3. `npm run memory:query -- "<topic>" --budget 6000` — explained, ranked context
4. `npm run memory:eval` after ranking/graph changes
5. [[Timeline]] / [[Knowledge Graph]] / `index.json`
6. [[Knowledge Engine Philosophy]] — when to change knowledge vs framework
7. [[Decisions]] / [[Architecture]] — enduring principles (`durability: permanent`)

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
