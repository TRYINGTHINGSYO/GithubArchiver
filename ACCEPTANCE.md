# Foundry v0.5 acceptance

Operational proof that Foundry can birth a project end-to-end.

## Prerequisites

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## Local acceptance (always runnable)

```bash
node scripts/acceptance-project-birth.mjs
```

Covers:

- health smoke (`standalone: true`)
- failed staging / destination conflict leaves destination untouched
- scaffold web project from plain-English brief
- install + verify
- git init + initial commit
- remote create **blocked** without `approved: true`
- registry under `FOUNDRY_HOME` / `~/.foundry`
- restart reopens the registered project
- no GithubArchiver paths in create payload or project files

## Full acceptance (needs your GitHub auth)

After `TRYINGTHINGSYO/Foundry` exists and `gh` can create repos under the org:

```bash
# 1) Publish Foundry itself (once) — see PUBLISH.md
# 2) Birth a child project with remote:
FOUNDRY_ACCEPTANCE_GITHUB=1 GITHUB_OWNER=TRYINGTHINGSYO \
  node scripts/acceptance-project-birth.mjs
```

Success also requires the new private GitHub repository to contain the verified local commit on `main`.

## Agent environment note

Cursor cloud agent tokens typically cannot call `createRepository`. In that environment the local suite must pass, and remote create after approval should fail at GitHub with an explicit permission error — never create silently.

## Last run (cloud agent)

| Step | Result |
|------|--------|
| Foundry typecheck / test / build | pass |
| Local project-birth acceptance | **pass** |
| `gh repo create TRYINGTHINGSYO/Foundry` | blocked (`createRepository`) |
| Child repo create after approval | blocked (`createRepository`) — approval gate itself passed |
