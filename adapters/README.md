# Foundry adapters

Coding agents and external services integrate here.

| Adapter | Status |
|---------|--------|
| `../src/agents/` Cursor | Live |
| Claude Code / Codex / Gemini / Aider | Detection stubs |
| `github.ts` | Optional remote repo create (`gh`) — **always requires approval** |

Foundry core must not import any managed application (including GithubArchiver).
