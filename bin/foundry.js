#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const cmd = args[0] || "start";
const rest = args.slice(1);

const map = {
  start: "index.js",
  setup: "cli/setup.js",
  doctor: "cli/doctor.js",
  diagnostics: "cli/diagnostics.js",
};

if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(`Foundry — local AI software engineering orchestrator

Usage:
  foundry              Start the UI (http://127.0.0.1:8787)
  foundry start        Same as above
  foundry setup        Interactive onboarding wizard
  foundry doctor       Detect agents / config / keys
  foundry diagnostics  Write a bug-report bundle
  foundry help         Show this help

Production entrypoints load compiled JavaScript from dist/.
Run \`npm run build\` after clone (or \`npm run dev\` for TypeScript watch).
`);
  process.exit(0);
}

const entryName = map[cmd];
if (!entryName) {
  console.error(`Unknown command: ${cmd}\nRun: foundry help`);
  process.exit(1);
}

const distEntry = path.join(root, "dist", entryName);
const srcEntry = path.join(
  root,
  "src",
  entryName.replace(/\.js$/, ".ts"),
);

let nodeArgs;
if (existsSync(distEntry)) {
  nodeArgs = [distEntry, ...rest];
} else if (existsSync(srcEntry)) {
  // Dev fallback when dist/ is missing — requires tsx as a local dependency.
  nodeArgs = ["--import", "tsx", srcEntry, ...rest];
} else {
  console.error(
    "Foundry build not found. Run: npm run build\n" +
      `(expected ${distEntry})`,
  );
  process.exit(1);
}

const child = spawn(process.execPath, nodeArgs, {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
