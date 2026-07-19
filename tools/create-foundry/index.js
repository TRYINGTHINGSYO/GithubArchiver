#!/usr/bin/env node
/**
 * npm create foundry — point users at the standalone Foundry product.
 */
console.log(`
╔══════════════════════════════════════╗
║     create-foundry · Foundry         ║
╚══════════════════════════════════════╝

Foundry is a standalone product (not part of GithubArchiver).

Preferred (after the org repo exists):
  git clone https://github.com/TRYINGTHINGSYO/Foundry.git
  cd Foundry && npm ci && npm run build && npm run setup && npm start

Until then, use the extracted branch:
  git clone -b foundry-standalone --single-branch \\
    https://github.com/TRYINGTHINGSYO/GithubArchiver.git Foundry
  cd Foundry && npm ci && npm run build && npm run setup && npm start

Publish the real remote with the remote-safe flow in Foundry's PUBLISH.md
(rename GithubArchiver origin → githubarchiver-source, then gh repo create).

Then register any app (including GithubArchiver) as an ordinary managed project.
`);
process.exit(0);
