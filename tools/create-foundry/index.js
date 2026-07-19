#!/usr/bin/env node
/**
 * npm create foundry — point users at the standalone Foundry product.
 */
console.log(`
╔══════════════════════════════════════╗
║     create-foundry · Foundry         ║
╚══════════════════════════════════════╝

Foundry is a standalone product (not part of GithubArchiver).

Preferred:
  git clone https://github.com/TRYINGTHINGSYO/Foundry.git
  cd Foundry && npm install && npm run setup && npm start

Until that repo exists, use the extracted branch on GithubArchiver:
  git clone -b foundry-standalone --single-branch \\
    https://github.com/TRYINGTHINGSYO/GithubArchiver.git Foundry
  cd Foundry && npm install && npm run setup && npm start

Then register any app (including GithubArchiver) as an ordinary managed project.
`);
process.exit(0);
