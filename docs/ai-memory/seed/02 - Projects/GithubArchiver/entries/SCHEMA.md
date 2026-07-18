---
status: active
project: githubarchiver
type: meta
---

# Checkpoint entry schema

Every durable checkpoint is one markdown file in this folder with YAML frontmatter.

```yaml
---
date: 2026-07-17          # UTC date of the decision / merge / incident
pr: 3                     # optional GitHub PR number
commit: e5476ac           # optional short or full SHA
area:                     # tags for filtering (lowercase)
  - search
  - daemon
type: incident            # architecture | incident | migration | pr | debt
status: merged            # merged | open | verified | superseded | open-debt
supersedes: null          # optional prior entry stem or "pr-N"
title: Short headline
migration: 30             # optional schema migration number
---
```

## Field rules

| Field | Required | Notes |
| --- | --- | --- |
| `date` | yes | ISO date `YYYY-MM-DD` |
| `type` | yes | One of the enum values above |
| `status` | yes | Lifecycle of this checkpoint |
| `title` | yes | One-line summary |
| `area` | no | Free-form tags; prefer stable ones: `search`, `daemon`, `enrichment`, `ingest`, `status-ui`, `migration`, `memory` |
| `pr` | no | Integer |
| `commit` | no | Prefer merge commit on `main` when merged |
| `supersedes` | no | Prior entry filename stem (without `.md`) or `pr-N` |
| `migration` | no | Integer schema version |

## Body

Keep the body short and factual:

- What changed
- Why
- Tests / verification
- Remaining open items (if any)

Do not paste chat transcripts.
