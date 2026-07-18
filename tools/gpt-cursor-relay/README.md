# GPT ⇄ Cursor Orchestrator

A local **AI development operating system**: supervisor/planner, interchangeable coding agent, verification plugins, memory, safety policies, crash recovery, and metrics.

```text
                You
                 │
                 ▼
        Supervisor / Planner
                 │
      ┌──────────┼──────────┐
      ▼          ▼          ▼
  Coding     Verification   Memory
   Agent        Engine       Engine
  (Cursor)    (plugins)   (disk)
      │          │           │
      └──────────┼───────────┘
                 ▼
          Project Workspace
```

## Reliability focus (v0.4)

1. **Plugin architecture** — built-ins + `plugins/` + project `.relay/plugins`
2. **Approval policies** — per-project YAML (`before_pushes`, `before_database_changes`, …)
3. **CodingAgent abstraction** — Cursor is an adapter; swap later without rewriting the core
4. **Rich execution timeline** — structured events for postmortems
5. **Crash recovery** — sessions persist under `~/.gpt-cursor-relay/sessions`
6. **Metrics dashboard** — success rate, avg rounds/cost, stop reasons
7. **Conflict handling** — detect overlapping parallel-worker files before merge

## Run

```bash
cd tools/gpt-cursor-relay
npm install
cp .env.example .env
npm start   # http://127.0.0.1:8787
```

## Project config

Copy `relay.config.example.yaml` into a project as `relay.config.yaml`:

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
```

## Tests

```bash
npm test
```
