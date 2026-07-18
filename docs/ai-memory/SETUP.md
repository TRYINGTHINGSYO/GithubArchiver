# AI Memory setup for Cursor (GithubArchiver)

Adapted from the open-source AI Memory Vault approach (boot file + structured vault + job priming) for Cursor. The boot layer here is **Project Rules** in `.cursor/rules/` instead of a root `CLAUDE.md`. Daily-note updates on every coding chat are intentionally optional — store durable outcomes only.

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
| `docs/ai-memory/AI-BOOT.md` | Tiny adapter for non-Cursor LLMs |

## What to store (and what not to)

Store only durable things:

- confirmed decisions
- architecture
- production failures and fixes
- merged PRs / deployment results
- unresolved next steps

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
