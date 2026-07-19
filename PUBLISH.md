# Publish TRYINGTHINGSYO/Foundry

This package is already standalone in structure. Use these steps to make it a
**standalone GitHub repository** (do not rely on `gh repo create --remote=origin`
while `origin` still points at GithubArchiver).

## From a `foundry-standalone` checkout

```bash
cd Foundry

# If origin still points at GithubArchiver:
git remote rename origin githubarchiver-source

gh repo create TRYINGTHINGSYO/Foundry \
  --private \
  --description "Local AI software engineering orchestrator" \
  --source=. \
  --remote=origin

# Push the extracted history onto main
git push -u origin HEAD:main

git branch -M main
git push -u origin main

# After the new remote is confirmed:
git remote -v
git remote remove githubarchiver-source
```

## Verify

```bash
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Keep `"private": true` until beta acceptance tests pass on a clean machine
(new project birth, crash recovery, rollback, approval interception, Cursor
auth failure, missing `git` / `gh`).

## Milestone: v0.5 — standalone repository and end-to-end project birth

Acceptance:

> Starting with only a natural-language idea and an empty destination,
> Foundry produces a working, tested, committed project and—after one explicit
> remote approval—a new private GitHub repository containing that project.
