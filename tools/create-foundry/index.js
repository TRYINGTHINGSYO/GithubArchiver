#!/usr/bin/env node
/**
 * npm create foundry — bootstrap the Foundry orchestrator from this monorepo
 * (or print install instructions when used standalone later).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const foundryRoot = path.resolve(__dirname, "../foundry");

console.log(`
╔══════════════════════════════════════╗
║     create-foundry · Foundry         ║
╚══════════════════════════════════════╝
`);

if (!existsSync(path.join(foundryRoot, "package.json"))) {
  console.error("Could not find tools/foundry next to create-foundry.");
  console.error("Clone GithubArchiver and run from the repo, or cd tools/foundry && npm run setup");
  process.exit(1);
}

console.log(`Foundry package: ${foundryRoot}`);
console.log("Running setup wizard…\n");

const child = spawn(
  process.execPath,
  ["--import", "tsx", path.join(foundryRoot, "src/cli/setup.ts"), ...process.argv.slice(2)],
  {
    cwd: foundryRoot,
    stdio: "inherit",
    env: process.env,
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
