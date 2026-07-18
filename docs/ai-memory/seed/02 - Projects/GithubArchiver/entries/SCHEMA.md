---
status: active
project: githubarchiver
type: meta
---

# Checkpoint entry schema

Append-only event log. Do not rewrite history — add a new entry and point typed edges at the prior one.

```yaml
---
schema: 1                             # metadata API version (required going forward)
id: incident-search-fallback-stale    # REQUIRED stable id
date: 2026-07-18
pr: 6
commit: 10cdc46
area:
  - search-fallback
type: incident
status: open
confidence: confirmed                 # confirmed | hypothesis | deprecated
durability: permanent                 # transient | temporary | release | permanent
relationships:
  - type: caused-by
    id: incident-gharchive-createevent
  - type: implemented-by
    id: pr-6
  - type: references
    id: migration-030
title: Short headline
migration: null
---
```

Missing `schema` defaults to `1`. Bump `MEMORY_SCHEMA_VERSION` in code when making incompatible metadata changes.

Legacy `related:` / `supersedes:` still work and are normalized into `relationships`.

## Relationship types

| type | Meaning |
| --- | --- |
| `caused-by` | Root cause / prior incident |
| `implemented-by` | PR or change that shipped it |
| `supersedes` | Replaces prior knowledge |
| `references` | Points at migration/doc/concept |
| `validates` | Test or verification artifact |
| `related` | Generic association |

## Durability

| value | Typical use |
| --- | --- |
| `permanent` | Decisions, root-cause incidents, migrations |
| `release` | Features / bugfixes tied to a ship |
| `temporary` | Open debt, transitional state |
| `transient` | Research / spikes |

Project Digest prefers permanent; Current Status emphasizes temporary/open.

## Retrieval pipeline

```text
Query → Stage1 candidates → Stage2 typed expand → Stage3 re-rank → budget assemble
```

```bash
npm run memory:timeline
npm run memory:query -- "search fallback"
npm run memory:query -- "search fallback" --budget 6000
npm run memory:query -- "search fallback" --follow caused-by,references
```

Score: `concept + edge + confidence + recency + durability + status`  
Default confidence filter: **confirmed only**.
