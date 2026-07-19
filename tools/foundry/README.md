# Foundry has moved

Foundry is a **standalone product**. It no longer lives inside GithubArchiver.

## Where to get it

### Intended repository

```text
https://github.com/TRYINGTHINGSYO/Foundry
```

Create it (from an account with org create rights) using the exact remote-safe flow in `PUBLISH.md` on the extract branch:

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

### Until that repository exists

Use branch **`foundry-standalone`** (v0.5: `dist/` build, CI, self-boundary):

```bash
git clone -b foundry-standalone --single-branch \
  https://github.com/TRYINGTHINGSYO/GithubArchiver.git Foundry
cd Foundry
npm ci
npm run build
npm run acceptance   # local project-birth proof
npm start
```

Prototype history: branch **`foundry-split`**.

## GithubArchiver is just a managed project

Register this repo with Foundry like any other folder via Open project or:

```bash
curl -X POST http://127.0.0.1:8787/api/projects/register \
  -H 'content-type: application/json' \
  -d "{\"name\":\"GithubArchiver\",\"path\":\"$(pwd)\"}"
```

Do not re-expand Foundry under `tools/foundry`.
