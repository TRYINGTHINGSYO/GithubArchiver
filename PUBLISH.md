# Publish TRYINGTHINGSYO/Foundry

This package is already standalone in structure. Create the **standalone GitHub
repository** from a machine where you are authenticated to GitHub with org
create rights (the Cursor cloud agent token cannot call `createRepository`).

Do **not** use `gh repo create --remote=origin` while `origin` still points at
GithubArchiver — rename that remote first.

## From a `foundry-standalone` checkout

```bash
git clone -b foundry-standalone --single-branch \
  https://github.com/TRYINGTHINGSYO/GithubArchiver.git Foundry
cd Foundry

git remote rename origin githubarchiver-source

gh repo create TRYINGTHINGSYO/Foundry \
  --private \
  --description "Local AI software engineering orchestrator" \
  --source=. \
  --remote=origin

git branch -M main
git push -u origin main

git remote remove githubarchiver-source
```

## Verify

```bash
git remote -v
git status
gh repo view TRYINGTHINGSYO/Foundry

npm ci
npm run typecheck
npm test
npm run build
npm start
```

Keep `"private": true` until beta acceptance tests pass on a clean machine
(new project birth, crash recovery, rollback, approval interception, Cursor
auth failure, missing `git` / `gh`).

## Next milestone after the remote exists

End-to-end project birth (not more agents or marketplace features):

```text
Create a brand-new project from a plain-English idea
→ scaffold it
→ verify it
→ initialize Git
→ create the initial commit
→ ask for approval
→ create a new private GitHub repository
→ push main
→ return the final URL and verification report
```

Acceptance:

> Starting with only a natural-language idea and an empty destination,
> Foundry produces a working, tested, committed project and—after one explicit
> remote approval—a new private GitHub repository containing that project.
