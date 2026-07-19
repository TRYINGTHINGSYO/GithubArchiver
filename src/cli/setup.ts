import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAgentDescriptors } from "../agents/registry.js";
import { setSecret } from "../secrets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

async function main() {
  const rl = createInterface({ input, output });
  console.log(`
╔══════════════════════════════════════╗
║         Foundry setup wizard         ║
╚══════════════════════════════════════╝
`);

  const agents = await listAgentDescriptors();
  console.log("Detected coding agents:");
  for (const a of agents) {
    console.log(`  ${a.available ? "✓" : "·"} ${a.displayName} — ${a.notes}`);
  }
  console.log("");

  const openai = (await rl.question("OpenAI API key (leave blank to skip): ")).trim();
  if (openai) {
    await setSecret("OPENAI_API_KEY", openai);
    console.log(
      "Saved OPENAI_API_KEY to locally encrypted credential file (~/.foundry/secrets.enc.json)",
    );
  }

  const cursor = (await rl.question("Cursor API key optional (leave blank to skip): ")).trim();
  if (cursor) {
    await setSecret("CURSOR_API_KEY", cursor);
    console.log("Saved CURSOR_API_KEY to locally encrypted credential file");
  }

  const createEnv = (await rl.question("Also write .env in this package? [y/N]: ")).trim().toLowerCase();
  if (createEnv === "y" || createEnv === "yes") {
    const lines = [
      openai ? `OPENAI_API_KEY=${openai}` : "# OPENAI_API_KEY=",
      cursor ? `CURSOR_API_KEY=${cursor}` : "# CURSOR_API_KEY=",
      "PORT=8787",
      "MAX_ROUNDS=12",
      "",
    ];
    await writeFile(path.join(root, ".env"), lines.join("\n"), "utf8");
    console.log("Wrote .env (prefer the encrypted vault when possible)");
  }

  const sample = (await rl.question("Write sample foundry.config.yaml into current directory? [y/N]: "))
    .trim()
    .toLowerCase();
  if (sample === "y" || sample === "yes") {
    const cwd = process.cwd();
    await writeFile(
      path.join(cwd, "foundry.config.yaml"),
      await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(root, "foundry.config.example.yaml"), "utf8").catch(() =>
          `plugins:\n  - sqlite\napproval:\n  before_pushes: true\n`,
        ),
      ),
      "utf8",
    );
    console.log(`Wrote ${path.join(cwd, "foundry.config.yaml")}`);
  }

  const gh = (
    await rl.question(
      "Authenticate GitHub CLI for optional remote repo creation? (gh auth login) [y/N]: ",
    )
  )
    .trim()
    .toLowerCase();
  if (gh === "y" || gh === "yes") {
    console.log(`
Remote repositories are never created silently.

After \`gh auth login\`, Foundry's Create Project flow will:
  1. Scaffold + verify locally
  2. Initialize Git + initial commit
  3. Show an approval screen (owner / name / visibility / push)
  4. Only then run \`gh repo create\` if you choose Create and push

Run manually if needed:  gh auth login
`);
  }

  await mkdir(path.join(root, "public"), { recursive: true });
  console.log(`
Setup complete.

Next:
  npm run build
  npm start          # or: node bin/foundry.js
  open http://127.0.0.1:8787
  foundry doctor     # health check
`);
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
