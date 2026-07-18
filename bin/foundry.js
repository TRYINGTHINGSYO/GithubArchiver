#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const cmd = args[0] || "start";
const rest = args.slice(1);

const map = {
  start: ["src/index.ts"],
  setup: ["src/cli/setup.ts", ...rest],
  doctor: ["src/cli/doctor.ts", ...rest],
  diagnostics: ["src/cli/diagnostics.ts", ...rest],
  help: null,
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
`);
  process.exit(0);
}

const entry = map[cmd];
if (!entry) {
  console.error(`Unknown command: ${cmd}\nRun: foundry help`);
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["--import", "tsx", path.join(root, entry[0]), ...entry.slice(1)],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
