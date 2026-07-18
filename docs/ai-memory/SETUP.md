# Project Knowledge Engine (GithubArchiver)

What began as an “AI memory vault” is now a **knowledge operating system** for the project: an append-only event log, typed knowledge graph, generated human views, and a read-only multi-stage retrieval engine.

Cursor integration uses **Project Rules** in `.cursor/rules/`. Daily-note diaries are intentionally out of scope — store durable engineering knowledge only.

## Layout (outside code repos)

Create once on your machine:

```text
C:\AI-Memory\
├── VAULT-INDEX.md
├── AI-BOOT.md
├── 00 - Inbox\
├── 01 - Daily Notes\
├── 02 - Projects\
│   ├── GithubArchiver\
│   ├── SiegeQueue\
│   ├── Inventory App\
│   └── Personal\
├── 03 - Knowledge\
├── 04 - Jobs\
├── 05 - People\
└── 99 - Archive\
```

Bootstrap GithubArchiver notes by copying:

```text
docs/ai-memory/seed/ → C:\AI-Memory\
```

Optional: set `AI_MEMORY_VAULT=C:\AI-Memory` so Cursor Cloud Agents and other environments can find the same vault path convention (`$HOME/AI-Memory` is also accepted).

## What lives in this repo

| Path | Role |
| --- | --- |
| `.cursor/rules/memory-system.mdc` | Always-on vault usage rules |
| `.cursor/rules/githubarchiver-context.mdc` | Project principles + which notes to load |
| `.cursor/rules/session-checkpoint.mdc` | When/how to persist durable outcomes |
| `docs/ai-memory/seed/` | Copyable starter vault notes for this project |
| `docs/ai-memory/seed/02 - Projects/GithubArchiver/entries/` | Structured checkpoints (YAML frontmatter) |
| `scripts/ai-memory-timeline.ts` | Regenerates Timeline + category indexes |
| `docs/ai-memory/AI-BOOT.md` | Tiny adapter for non-Cursor LLMs |

## Structured checkpoints (event log)

Each durable event is one append-only markdown file with queryable frontmatter:

`date`, `pr`, `commit`, `area`, `type`, `status`, `supersedes`, `related`, `id`, …

See `entries/SCHEMA.md`. Prefer adding a new entry over rewriting history.

Types include: `decision`, `incident`, `migration`, `feature`, `bugfix`, `performance`, `refactor`, `test`, `release`, `technical-debt`, `research`.

Regenerate derived views after adding an entry:

```bash
npm run memory:timeline
```

Primary generated artifacts:

| File | Role |
| --- | --- |
| `Timeline.md` | Chronological event log |
| `Current Status.md` | Living summary (open work, debt, recent merges) |
| `Project Digest.md` | Single AI-priming document |
| `Knowledge Graph.md` | `related` / `supersedes` link map |
| `index.json` | Machine-readable index for agents/tooling |

Plus convenience indexes (`PR Timeline.md`, `Production Incidents.md`, …) and `indexes/<type>.md`.

### Retrieval (PR #10–#13) — read-only

```text
Human / AI → Append Event → Validation → Graph → Generated Views → Retrieval
```

**Retrieval never writes to the vault.** Durable knowledge enters only through explicit `entries/*.md` appends.

```text
Query → candidates → typed expand → re-rank → budget assemble
```

```bash
npm run memory:query -- "search fallback"
npm run memory:query -- "search fallback" --budget 6000
npm run memory:eval
```

Each query prints **metrics** (candidates / expanded / ranked / returned / budget) and **explanations** per hit. Eval cases live in `docs/ai-memory/evals/`.

Default confidence filter: **confirmed only**. Metadata API version: `schema: 1`.

Principle: **If retrieval fails, improve the knowledge — not the framework.**

See `docs/ai-memory/seed/02 - Projects/GithubArchiver/Knowledge Engine Philosophy.md`.

Success is retrieval precision, eval stability, time-to-context, and capture rate — not corpus size. New retrieval capabilities must earn their way in through observed limitations, not hypothetical ones.

## What to store (and what not to)

Store only durable things:

- confirmed decisions
- architecture
- production failures and fixes
- merged PRs / deployment results
- migrations
- unresolved technical debt

Do **not** force daily-note updates on every coding chat — that creates noisy memory.

Never store secrets, tokens, or credentials in the vault.

## Daily Cursor prompts that work well

Start:

```text
Read the GithubArchiver project memory and inspect the relevant code. Do not edit anything yet. Explain the current behavior and propose a plan.
```

Implement:

```text
Implement the plan, add regression coverage, run the relevant tests, and update Current Status.md with the durable result.
```

Finish:

```text
Create a concise checkpoint in the project memory with what changed, why, tests, deployment status, and remaining verification.
```
