# Move Foundry to `A:\chatgptcodex\foundry-main`

This cloud agent **cannot write to your `A:` drive**. Run these on your Windows PC.

## Recommended: clone into that folder

In **PowerShell**:

```powershell
New-Item -ItemType Directory -Force -Path "A:\chatgptcodex" | Out-Null
if (Test-Path "A:\chatgptcodex\foundry-main") {
  Write-Error "A:\chatgptcodex\foundry-main already exists — rename or remove it first."
  exit 1
}

git clone -b foundry-standalone --single-branch `
  https://github.com/TRYINGTHINGSYO/GithubArchiver.git `
  "A:\chatgptcodex\foundry-main"

cd A:\chatgptcodex\foundry-main
git branch --show-current
# expect: foundry-standalone

npm ci
npm run build
```

Then publish to GitHub (still required for `TRYINGTHINGSYO/Foundry`):

```powershell
cd A:\chatgptcodex\foundry-main
git remote rename origin githubarchiver-source
gh repo create TRYINGTHINGSYO/Foundry --private --description "Local AI software engineering orchestrator" --source=. --remote=origin
git branch -M main
git push -u origin main
git remote remove githubarchiver-source
gh repo view TRYINGTHINGSYO/Foundry --web
```

## What this moves

Everything that is Foundry lives on branch `foundry-standalone` (standalone package root).  
`GithubArchiver\tools\foundry` is only a pointer README — do not copy that.

After clone, `A:\chatgptcodex\foundry-main` should contain:

```text
src\  public\  plugins\  adapters\  tests\  bin\
package.json  README.md  PUBLISH.md  ROADMAP.md  FRICTION.md
```
