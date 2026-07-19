# Foundry

**v0.5** — Local AI software engineering orchestrator: create, open, build, test, and manage any project.

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
                    │
                    ▼
             Task Dependency Graph → Coding agents → Verify
```

## Quick start

```bash
npm install
npm run build
npm run setup          # optional onboarding
npm start              # http://127.0.0.1:8787  (node dist/index.js)
```

Development (TypeScript watch — not required for production):

```bash
npm run dev
```

CLI:

```bash
node bin/foundry.js            # start UI (loads dist/)
node bin/foundry.js doctor
node bin/foundry.js diagnostics
```

Package remains `"private": true` while beta. Do not publish to npm yet.

## Modes

1. **Create a new project** — name, description, destination, template/custom brief, Git init, optional GitHub (approval required)
2. **Open an existing project** — folder + task
3. **Resume a previous run** — crash recovery

New projects stage under `~/.foundry/staging/`, verify, then move to the destination only on success.

## GitHub remote (approval required)

Local `git init` + initial commit need no remote approval. Creating a GitHub repository, pushing, changing visibility, or deleting a remote **always** requires an explicit UI/API approval (`approved: true`).

Authenticate once with `gh auth login` (also prompted during `foundry setup`).

## Self-project boundary

When Foundry opens **its own** repository, it forces:

- Plan approval required
- Push / dependency / deploy / self-update approvals required
- Trust capped at `safe_edits`

See `foundry.config.yaml` and `src/self-boundary.ts`.

## State

```text
~/.foundry/          # projects.json, sessions, memory, staging, metrics, secrets
foundry.config.yaml  # per managed project
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Compile `src/` → `dist/` |
| `npm start` | `node dist/index.js` |
| `npm run typecheck` | `tsc` (build + tests) |
| `npm test` | Vitest |
| `npm run acceptance` | Local project-birth acceptance |
| `npm run acceptance:github` | Same + remote create (needs `gh` org rights) |
| `npm run prepublishOnly` | typecheck + test + build (blocked while private) |

See [ACCEPTANCE.md](./ACCEPTANCE.md), [PUBLISH.md](./PUBLISH.md), and [ROADMAP.md](./ROADMAP.md).

**v0.6 rule:** only ship changes that remove friction found while building a real project.

CI (GitHub Actions): `npm ci` → typecheck → test → build on every push/PR.

## Standalone repository

If you are still on the interim `foundry-standalone` branch inside GithubArchiver, publish the real remote with [PUBLISH.md](./PUBLISH.md).

## Extraction history

See [EXTRACTION.md](./EXTRACTION.md).
