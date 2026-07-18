---
status: active
project: githubarchiver
type: meta
---

# Checkpoint entry schema

Every durable checkpoint is one markdown file in this folder with YAML frontmatter.
Treat `entries/` as an **append-only event log**. Do not rewrite old entries to change history — add a new entry and point `supersedes` / `related` at the prior one.

```yaml
---
id: incident-gharchive-createevent   # REQUIRED stable id (survives renames)
date: 2026-07-17
pr: 3
commit: e5476ac
area:
  - search
  - search-fallback
type: incident
status: merged
confidence: confirmed                 # confirmed | hypothesis | deprecated
supersedes: null
related:
  - migration-030
  - search-fallback
  - pr-6
title: Short headline
migration: 30
---
```

## Types

`decision` · `incident` · `migration` · `feature` · `bugfix` · `performance` · `refactor` · `test` · `release` · `technical-debt` · `research`

## Status

`merged` | `open` | `verified` | `superseded` | `open-debt`

## Confidence

| value | Meaning |
| --- | --- |
| `confirmed` | Verified production fact / shipped decision |
| `hypothesis` | Investigation or unproven theory |
| `deprecated` | Superseded or no longer operative |

Retrieval down-ranks `deprecated` and `hypothesis` unless explicitly included.

## Related graph

Prefer stable `id:` values in `related`. Also accepted: `pr-N`, `migration-NNN`, concept tags from `area:`.

## Tooling

```bash
npm run memory:timeline          # regenerate markdown views + index.json
npm run memory:query -- "…"      # ranked graph retrieval (confirmed by default)
npm run memory:query -- "…" --include-hypotheses
```

Retrieval score:

`concept(≤40) + edge(≤25) + confidence(≤15) + recency(≤10) + durability(≤5) + status(≤5)`

Machine-readable index: `../index.json` (generated).
