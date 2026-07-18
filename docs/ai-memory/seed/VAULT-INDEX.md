---
status: active
project: meta
type: index
---

# VAULT INDEX

Persistent memory for Blake's projects. Used by Cursor Project Rules and other LLM adapters.

## Vault location

- Windows: `C:\AI-Memory`
- Env override: `AI_MEMORY_VAULT`
- Fallback: `$HOME/AI-Memory`

## Projects

- **[[GithubArchiver]]** — GithubArchive+ repository intelligence platform (SvelteKit, SQLite, Railway). Status: Active.
- **SiegeQueue** — (add when primed)
- **Inventory App** — (add when primed)
- **Personal** — (add when primed)

## Vault Structure

```text
00 - Inbox          ← Capture, sort later
01 - Daily Notes    ← Optional; prefer durable project notes for coding work
02 - Projects       ← Per-project indexes, decisions, current status
03 - Knowledge      ← Cross-project reference
04 - Jobs           ← Recurring task priming lists
05 - People
99 - Archive
```

## Working rules for coding agents

- Load only notes needed for the current task.
- Treat Decisions.md as authoritative unless the user revises them.
- Checkpoint durable outcomes; do not transcript-dump chats.
- Never store secrets.
