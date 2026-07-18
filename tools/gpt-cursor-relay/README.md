# GPT ⇄ Cursor Orchestrator

Local AI software engineering orchestrator:

```text
You
  │
  ▼
Supervisor GPT  (plan · review · verify · intervene)
  │
  ├──────────────┐
  ▼              ▼
Cursor #1      Cursor #2   (git worktrees)
Backend        Frontend
  │              │
  └──────┬───────┘
         ▼
Automatic verification (test/build/lint/browser smoke)
         │
         ▼
Final implementation (+ rollback checkpoint)
```

## Features (v0.3)

1. **Parallel Cursor agents** — specialized workers in git worktrees, then merge
2. **Automatic verification** — `npm test` / build / lint + GPT “does it actually work?”
3. **Browser smoke checks** — optional HTTP checks against local web servers
4. **Git intelligence** — theme, bullets, risk, breaking changes, migration
5. **Planning mode** — approve a plan before Cursor edits
6. **Rollback** — one-click undo via git checkpoint
7. **Conversation memory** — long-term per-project memory on disk
8. **Coding style learning** — prefers/avoids extracted from accepted work
9. **Supervisor mode** — watches Cursor activity and can redirect/stop mid-run

Plus prior v1.5: streaming, visual diff, cost, auto-detect, smarter stops.

## Run

```bash
cd tools/gpt-cursor-relay
npm install
cp .env.example .env   # OPENAI_API_KEY
npm start              # http://127.0.0.1:8787
```

## Typical flow

1. Type a task → optional project detect
2. GPT proposes a **plan** → Approve Plan
3. GPT may launch **parallel workers** (backend/frontend/tests/docs)
4. Supervisor watches live Cursor tool activity
5. Automatic verification runs after edits
6. Git intelligence summarizes the change set
7. On complete: next improvements + **Undo last run** if needed

## Tests

```bash
npm test
```
