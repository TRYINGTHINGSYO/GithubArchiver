# Foundry

Local **AI software engineering orchestrator**: planner, task dependency graphs, interchangeable coding agents, verification plugins, memory, safety policies, crash recovery, and metrics.

Cursor is one adapter — not the product identity.

```text
                   You
                    │
                    ▼
                 Foundry
                    │
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
 Planner       Memory Engine   Policy Engine
     │              │              │
     └──────────────┼──────────────┘
                    ▼
             Task Dependency Graph
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
 Cursor        Claude Code*     Codex*
      ▼             ▼             ▼
        Verification & Merge
                    │
                    ▼
              Final Workspace

* adapter stubs — detection ready, execution next
```

## Product tracks

1. **Production readiness** — `foundry setup` / `doctor` / `diagnostics`, encrypted API-key vault, cross-platform Node CLI
2. **Multi-model** — `CodingAgent` interface + agent registry (Cursor live; Claude Code / Codex / Gemini / Aider detected)
3. **Marketplace** — local plugin catalog (`playwright`, `railway`, `sqlite`, …) installable via API/UI

## Quick start

```bash
cd tools/foundry
npm install
npm run setup          # or: node bin/foundry.js setup
npm start              # http://127.0.0.1:8787
```

From the monorepo root:

```bash
npm run foundry
npm run foundry:test
```

One-command path after install:

```bash
node bin/foundry.js            # start UI
node bin/foundry.js doctor     # agents + keys
node bin/foundry.js diagnostics
```

Scaffold from the monorepo:

```bash
node tools/create-foundry/index.js
# or: npm create foundry  (when published)
```

## Project config

Copy `foundry.config.example.yaml` into a project as `foundry.config.yaml` (legacy `relay.config.yaml` still works):

```yaml
plugins:
  - playwright
  - railway
  - sqlite

approval:
  before_database_changes: true
  before_deleting_files: true
  before_dependency_updates: true
  before_commits: false
  before_pushes: true

agent: cursor
```

## Task graphs

When planning is enabled, Foundry builds a DAG from plan steps (`dependsOn`). Ready nodes run (optionally in parallel), each node is verified, and failures only block dependent branches. Retry a failed node from the UI without replaying the whole run.

## Credentials

Keys are stored in a **locally encrypted credential file** (`~/.foundry/secrets.enc.json`, AES-256-GCM with machine-local key material). This is not a substitute for OS keychain / Credential Manager / Secret Service — those backends are the intended end state. Env vars still override. Set `FOUNDRY_HOME` to relocate state.

## Trust levels

Set in `foundry.config.yaml`:

```yaml
trust: safe_edits   # read_only | safe_edits | local_autonomous | full_automation
```

Shown permanently in the UI next to the project. Push/deploy require `full_automation` (and approval).

## UX principles

The Run screen answers four questions: what is Foundry doing, is it working, does it need me, what changed. Everything else lives in tabs. Follow-ups start as **new runs**, never silent continuation. Repository knowledge-graph tooling is under **Project Intelligence**, not rebuilt per coding task.

## Tests

```bash
npm test
npm run typecheck
```
