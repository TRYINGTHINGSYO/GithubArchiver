# Extraction from GithubArchiver

Foundry began as an in-repository prototype under `GithubArchiver/tools/foundry` (PR #26). It is now a standalone product.

## How this history was preserved

```bash
# Inside GithubArchiver, on the Foundry branch:
git subtree split --prefix=tools/foundry -b foundry-split

# New empty repo:
mkdir Foundry && cd Foundry && git init
git pull /path/to/GithubArchiver foundry-split
```

Alternative with [git-filter-repo](https://github.com/newren/git-filter-repo):

```bash
git clone GithubArchiver Foundry-extract
cd Foundry-extract
git filter-repo --subdirectory-filter tools/foundry
```

## Post-extraction checklist

- [x] Root layout: `src/`, `public/`, `plugins/`, `adapters/`, `tests/`, `package.json`, `README.md`
- [x] Remove GithubArchiver-specific known-project hardcoding
- [x] Landing: create / open / resume
- [x] Scaffold engine with staging → verify → destination
- [x] Local Git init; GitHub remote requires approval
- [x] Global state under `~/.foundry`
- [ ] Publish / install globally (`npx foundry`)
- [ ] Remove `tools/foundry` from GithubArchiver (pointer README)
- [ ] Register GithubArchiver in `~/.foundry/projects.json` as an ordinary managed project

## Remote

Intended repository: `TRYINGTHINGSYO/Foundry`
