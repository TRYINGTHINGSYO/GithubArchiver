# Foundry has moved

Foundry is a **standalone product**. It no longer lives inside GithubArchiver.

## Where to get it

Intended repository (create if missing):

```text
https://github.com/TRYINGTHINGSYO/Foundry
```

Until that repository exists, the extracted tree (with create/open/resume scaffolding) is preserved on this repo as branch **`foundry-standalone`**:

```bash
git clone -b foundry-standalone --single-branch \
  https://github.com/TRYINGTHINGSYO/GithubArchiver.git Foundry
cd Foundry
npm install
npm start
```

Prototype history (pre-extraction `tools/foundry` commits) is on branch **`foundry-split`** (`git subtree split --prefix=tools/foundry`).

## GithubArchiver is just a managed project

Register this repo with Foundry like any other folder:

```bash
# From Foundry UI: Open an existing project → path to GithubArchiver
# Or via API:
curl -X POST http://127.0.0.1:8787/api/projects/register \
  -H 'content-type: application/json' \
  -d "{\"name\":\"GithubArchiver\",\"path\":\"$(pwd)\"}"
```

Do not re-expand Foundry under `tools/foundry`.
