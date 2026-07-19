# Publish TRYINGTHINGSYO/Foundry

**Status:** `TRYINGTHINGSYO/Foundry` does **not** exist on GitHub yet (404).
The code lives only on branch `foundry-standalone` inside
`TRYINGTHINGSYO/GithubArchiver`. Nothing auto-publishes it — you must run
`gh repo create` from a machine logged into GitHub with org create rights.

The Cursor cloud agent token cannot call `createRepository`.

Do **not** use `gh repo create --remote=origin` while `origin` still points at
GithubArchiver — rename that remote first.

---

## 1. Get a Foundry checkout

```powershell
git clone -b foundry-standalone --single-branch https://github.com/TRYINGTHINGSYO/GithubArchiver.git Foundry
cd Foundry
```

Confirm you are in the right place:

```powershell
git branch --show-current
git remote -v
gh auth status
```

Expect branch `foundry-standalone` (or `main` after you rename it below), and
`origin` pointing at GithubArchiver before the rename step.

---

## 2. Create the repo (PowerShell-safe)

Backslashes are **not** line continuations in PowerShell. Use one line per command:

```powershell
git remote rename origin githubarchiver-source

gh repo create TRYINGTHINGSYO/Foundry --private --description "Local AI software engineering orchestrator" --source=. --remote=origin

git branch -M main
git push -u origin main

git remote remove githubarchiver-source
```

### Bash / Git Bash / macOS / Linux

```bash
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

---

## 3. Verify

```powershell
git remote -v
git status
gh repo view TRYINGTHINGSYO/Foundry --web

npm ci
npm run typecheck
npm test
npm run build
npm start
```

Then:

```powershell
FOUNDRY_ACCEPTANCE_GITHUB=1 npm run acceptance:github
git tag -a v0.5.0-beta.1 -m "Foundry v0.5 — standalone project birth"
git push origin v0.5.0-beta.1
```

Keep `"private": true` until beta acceptance on a clean machine.

---

## Why the dashboard is empty

The repository creation command has not been run successfully on your computer
yet. Until it has, GitHub will keep returning 404 for `TRYINGTHINGSYO/Foundry`.
