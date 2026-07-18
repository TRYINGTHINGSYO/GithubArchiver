import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { listAgentDescriptors } from "../agents/registry.js";
import { loadProjectConfig } from "../config.js";
import { loadMetrics, summarizeMetrics } from "../metrics.js";
import { listRecoverableSessions } from "../recovery.js";
import { resolveApiKeys } from "../secrets.js";

async function main() {
  const outDir = path.join(
    process.cwd(),
    `foundry-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  await mkdir(outDir, { recursive: true });

  const keys = await resolveApiKeys();
  const agents = await listAgentDescriptors();
  const metrics = summarizeMetrics(await loadMetrics());
  const sessions = await listRecoverableSessions();
  const cfg = await loadProjectConfig(process.cwd());

  const report = {
    generatedAt: new Date().toISOString(),
    platform: {
      os: process.platform,
      arch: process.arch,
      node: process.version,
      cwd: process.cwd(),
      home: homedir(),
    },
    keys: {
      openaiPresent: Boolean(keys.openaiApiKey),
      cursorPresent: Boolean(keys.cursorApiKey),
      source: keys.source,
      // Never include actual key material
    },
    agents: agents.map((a) => ({
      id: a.id,
      available: a.available,
      notes: a.notes,
    })),
    configSource: cfg.source,
    config: {
      plugins: cfg.config.plugins,
      approval: cfg.config.approval,
    },
    metrics,
    recoverySessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      projectName: s.projectName,
      task: s.task,
      round: s.round,
      status: s.status,
      updatedAt: s.updatedAt,
    })),
  };

  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");

  // Redacted env dump
  const envSafe: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue;
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(k)) {
      envSafe[k] = `[redacted len=${v.length}]`;
    } else if (k.startsWith("FOUNDRY") || k.startsWith("RELAY") || k === "PATH") {
      envSafe[k] = v.length > 500 ? `${v.slice(0, 500)}…` : v;
    }
  }
  await writeFile(path.join(outDir, "env.redacted.json"), JSON.stringify(envSafe, null, 2), "utf8");

  // Recent recovery files (metadata only already in report)
  await writeFile(
    path.join(outDir, "README.txt"),
    [
      "Foundry diagnostics bundle",
      "Safe to attach to bug reports — secrets are redacted.",
      "",
      "Contents:",
      "- report.json",
      "- env.redacted.json",
    ].join("\n"),
    "utf8",
  );

  console.log(`Diagnostics written to:\n  ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
