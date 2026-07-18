# AI Memory Boot

Persistent memory is stored in the vault at `C:\AI-Memory` (or `$AI_MEMORY_VAULT` / `$HOME/AI-Memory`).

Startup sequence:

1. Read `VAULT-INDEX.md`.
2. Identify the relevant project.
3. Read that project's index.
4. Load only task-relevant notes.
5. Search the vault before claiming prior context is unavailable.
6. Persist durable decisions and confirmed outcomes.
7. Never store secrets.
8. Clearly label assumptions and uncertainty.

Adapters:

- **Cursor:** `.cursor/rules/*.mdc` in each code repo
- **Claude Code:** `CLAUDE.md` in the working directory (points at the same vault)
- **Codex / other coding agents:** `AGENTS.md` or the tool's instruction file
- **Chat-based LLM:** attach this file plus the relevant project notes
