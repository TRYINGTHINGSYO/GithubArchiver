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
id: incident-gharchive-createevent   # optional stable id (defaults to filename stem)
date: 2026-07-17
pr: 3
commit: e5476ac
area:
  - search
  - daemon
type: incident
status: merged
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

| type | Use for |
| --- | --- |
| `decision` | Locked architectural / product choices |
| `incident` | Production failures and root-cause writeups |
| `migration` | Schema/version migrations (or set `migration:` on another type) |
| `feature` | New capability |
| `bugfix` | Correctness fix that is not a full incident writeup |
| `performance` | Throughput / latency / cost work |
| `refactor` | Structural change without intended behavior change |
| `test` | Coverage / harness improvements as the main change |
| `release` | Deploy / release notes |
| `technical-debt` | Known unresolved debt |
| `research` | Spikes / investigations without a ship decision yet |

Legacy aliases still accepted by the generator: `architecture`→`decision`, `debt`→`technical-debt`, `pr`→`feature`.

## Status

`merged` | `open` | `verified` | `superseded` | `open-debt`

## Related graph

`related` is a list of ids. Resolvers understand:

- explicit `id:` values
- entry filename stems
- `pr-N`
- `migration-N` / `migration-00N`
- first entry tagged with that `area` (concept tag)

## Body

Short and factual: what / why / tests / remaining verification. No chat transcripts. No secrets.

After adding an entry:

```bash
npm run memory:timeline
```
