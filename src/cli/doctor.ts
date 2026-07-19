import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAgentDescriptors } from "../agents/registry.js";
import { loadProjectConfig } from "../config.js";
import { discoverPlugins } from "../plugins/loader.js";
import { credentialStoreInfo } from "../credentials.js";
import { resolveApiKeys } from "../secrets.js";
import { TRUST_LABELS, normalizeTrustLevel } from "../trust.js";
import { checkForUpdate } from "../version.js";
import { which } from "./which.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("Foundry doctor\n");

  const update = await checkForUpdate();
  console.log(`· ${update.message}`);

  const node = process.version;
  console.log(`✓ Node ${node} (${process.platform}/${process.arch})`);

  const creds = credentialStoreInfo();
  console.log(`· Credentials: ${creds.label}`);
  console.log(`  ${creds.description}`);

  const keys = await resolveApiKeys();
  if (keys.openaiApiKey) {
    console.log(`✓ OpenAI API key (${keys.source})`);
  } else {
    console.log("✗ OPENAI_API_KEY missing — run: foundry setup");
  }

  const agents = await listAgentDescriptors();
  for (const a of agents) {
    console.log(`${a.available ? "✓" : "·"} Agent ${a.displayName}: ${a.notes}`);
  }

  const git = await which("git");
  console.log(git ? `✓ git at ${git}` : "✗ git not found");

  const project = process.cwd();
  const cfg = await loadProjectConfig(project);
  console.log(
    cfg.source
      ? `✓ Project config: ${cfg.source}`
      : `· No foundry.config.yaml in ${project} (using defaults)`,
  );
  const trust = normalizeTrustLevel(cfg.config.trust);
  console.log(`· Trust: ${TRUST_LABELS[trust]}`);

  const plugins = await discoverPlugins(project, cfg.config.plugins);
  console.log(
    `✓ Plugins (${plugins.source}): ${plugins.active.map((p) => p.id).join(", ") || "(none)"}`,
  );

  const ui = path.join(root, "public/index.html");
  console.log((await exists(ui)) ? "✓ UI assets present" : "✗ UI assets missing");

  const ok = Boolean(keys.openaiApiKey && agents.some((a) => a.id === "cursor" && a.available));
  console.log(ok ? "\nFoundry looks ready." : "\nFoundry needs setup (API key and/or Cursor agent).");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
