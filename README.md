# Foundry

Local **AI software engineering orchestrator**: create new projects, open existing ones, plan with a supervisor, run coding agents against a task graph, verify, and report.

Cursor is one adapter — not the product identity. Foundry is not tied to any parent application repository.

```text
                   You
                    │
                    ▼
                 Foundry
         create · open · resume
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
```

\* adapter stubs — detection ready, execution next

## Quick start

```bash
npm install
npm run setup          # or: node bin/foundry.js setup
npm start              # http://127.0.0.1:8787
```

Global-style entry:

```bash
node bin/foundry.js            # start UI
node bin/foundry.js doctor     # agents + keys
node bin/foundry.js diagnostics
```

When published:

```bash
npx foundry
# or: npm i -g foundry && foundry
```

## Modes

The UI starts with three choices:

1. **Create a new project** — name, description, destination, template (or blank/custom), Git init, optional GitHub repo (approval required)
2. **Open an existing project** — point at a folder and describe a task
3. **Resume a previous run** — recover a crashed or interrupted session

New projects are built in an isolated staging directory under `~/.foundry/staging/`, verified (install + test/build), then moved to the destination only on success.

## Project templates

Built-in templates include web app, API service, desktop app, CLI, automation script, static site, Discord bot, data pipeline, existing repository, and blank/custom. A natural-language brief is stored as `PROJECT.md` so the supervisor can refine structure in follow-up runs.

## Git & GitHub

Local Git init and the initial commit run without remote side effects. Creating a GitHub repository, pushing, changing visibility, or deleting a remote **always requires explicit approval** via the UI or `POST /api/projects/github-create` with `{ "approved": true, ... }`.

## State layout

Global state (override with `FOUNDRY_HOME`):

```text
~/.foundry/
├─ projects.json
├─ sessions/
├─ memory/
├─ plugins/
├─ templates/
├─ credentials/   # secrets.enc.json (locally encrypted credential file)
├─ staging/
└─ metrics/
```

Per managed project (optional):

```text
foundry.config.yaml
.foundry/
├─ project-memory.json
└─ local-plugins/
```

Register any existing folder (including apps you already maintain) through the UI or `POST /api/projects/register`. Foundry core does not import or hardcode those applications.

## Project config

Copy `foundry.config.example.yaml` into a project as `foundry.config.yaml`:

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
trust: safe_edits   # read_only | safe_edits | local_autonomous | full_automation
```

## Extraction history

This repository was extracted from `GithubArchiver/tools/foundry` via `git subtree split`. See [EXTRACTION.md](./EXTRACTION.md).

## Tests

```bash
npm test
npm run typecheck
```
