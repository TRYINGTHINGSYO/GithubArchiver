#!/usr/bin/env node
/**
 * Foundry v0.5 operational acceptance: project birth.
 *
 * Local path always runs. Remote GitHub create runs only when:
 *   FOUNDRY_ACCEPTANCE_GITHUB=1 and gh can create repos.
 *
 * Usage:
 *   node scripts/acceptance-project-birth.mjs
 *   FOUNDRY_ACCEPTANCE_GITHUB=1 node scripts/acceptance-project-birth.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir, access, readFile } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.FOUNDRY_ACCEPTANCE_PORT || 8791);
const base = `http://127.0.0.1:${port}`;
const wantGithub = process.env.FOUNDRY_ACCEPTANCE_GITHUB === "1";

const report = {
  ok: false,
  steps: [],
  github: null,
  projectPath: null,
  registry: null,
  errors: [],
};

function step(name, detail) {
  report.steps.push({ name, ...detail });
  const mark = detail.ok ? "✓" : "✗";
  console.log(`${mark} ${name}${detail.message ? ` — ${detail.message}` : ""}`);
}

async function waitHealth(ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return res.json();
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Foundry health check timed out");
}

async function main() {
  const home = await mkdtemp(path.join(tmpdir(), "foundry-accept-home-"));
  const destRoot = await mkdtemp(path.join(tmpdir(), "foundry-accept-dest-"));
  const projectName = "GameShelf";
  const destination = path.join(destRoot, projectName);
  process.env.FOUNDRY_HOME = home;

  const child = spawn(process.execPath, [path.join(root, "dist/index.js")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), FOUNDRY_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout.on("data", (d) => {
    serverLog += d.toString();
  });
  child.stderr.on("data", (d) => {
    serverLog += d.toString();
  });

  try {
    const health = await waitHealth();
    step("health smoke", {
      ok: health.ok && health.standalone === true,
      message: `product=${health.product} version=${health.version}`,
    });
    if (String(JSON.stringify(health)).includes("GithubArchiver")) {
      throw new Error("Health payload references GithubArchiver");
    }

    // Failed staging / destination conflict must leave destination untouched
    await access(destRoot, fsConstants.W_OK);
    const conflictFile = path.join(destRoot, "keep-me.txt");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(conflictFile, "preserve", "utf8");
    const conflictRes = await fetch(`${base}/api/projects/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "ShouldFail",
        description: "conflict probe",
        destination: destRoot,
        template: "web-app",
        initGit: true,
        createGithubRepo: false,
      }),
    });
    const conflictBody = await conflictRes.json();
    const kept = await readFile(conflictFile, "utf8");
    step("failed staging leaves destination intact", {
      ok:
        conflictRes.status === 400 &&
        conflictBody.error === "destination_conflict" &&
        kept === "preserve",
      message: conflictBody.error || conflictBody.message,
    });

    // Happy path create
    const createRes = await fetch(`${base}/api/projects/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: projectName,
        description:
          "A clean mobile-friendly web app for organizing my games with cover art and play status.",
        brief:
          "A clean mobile-friendly web app for organizing my games with cover art and play status.",
        destination,
        template: "web-app",
        initGit: true,
        createGithubRepo: true,
        githubOwner: process.env.GITHUB_OWNER || "TRYINGTHINGSYO",
        githubVisibility: "private",
      }),
    });
    const created = await createRes.json();
    report.projectPath = created.destinationPath || destination;
    const files = existsSync(destination) ? await readdir(destination) : [];
    const noGaPaths =
      !JSON.stringify(created).includes("GithubArchiver") &&
      !files.some((f) => f.toLowerCase().includes("githubarchiver"));
    let gitClean = false;
    if (created.ok && existsSync(path.join(destination, ".git"))) {
      const { execFileSync } = await import("node:child_process");
      const status = execFileSync("git", ["status", "--porcelain"], {
        cwd: destination,
        encoding: "utf8",
      }).trim();
      gitClean = status.length === 0;
    }
    step("scaffold + verify + git init + commit", {
      ok:
        createRes.status === 201 &&
        created.ok &&
        created.gitInitialized &&
        created.initialCommit &&
        files.includes("package.json") &&
        gitClean &&
        noGaPaths,
      message: created.message + (gitClean ? "" : " (dirty worktree after commit)"),
    });
    if (!created.ok) throw new Error(created.message || "create failed");

    // Approval required
    const denyRes = await fetch(`${base}/api/projects/github-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approved: false,
        owner: created.pendingGithub?.owner || "TRYINGTHINGSYO",
        name: created.pendingGithub?.name || projectName,
        cwd: destination,
        push: true,
      }),
    });
    const denyBody = await denyRes.json();
    step("remote create blocked without approval", {
      ok: denyRes.status === 403 && /approval/i.test(denyBody.error || ""),
      message: denyBody.error,
    });

    if (wantGithub && created.pendingGithub) {
      const ghRes = await fetch(`${base}/api/projects/github-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved: true,
          owner: created.pendingGithub.owner,
          name: created.pendingGithub.name,
          visibility: "private",
          cwd: created.pendingGithub.cwd,
          push: true,
        }),
      });
      const ghBody = await ghRes.json();
      report.github = ghBody;
      step("remote create + push after approval", {
        ok: ghRes.ok && ghBody.ok === true,
        message: ghBody.url || ghBody.message || ghBody.error,
      });
    } else {
      step("remote create + push after approval", {
        ok: true,
        message:
          "skipped (set FOUNDRY_ACCEPTANCE_GITHUB=1 when gh can create repos)",
        skipped: true,
      });
    }

    // Registry
    const listRes = await fetch(`${base}/api/projects`);
    const listBody = await listRes.json();
    const registered = (listBody.projects || []).find(
      (p) => p.path === destination || p.name === projectName,
    );
    report.registry = registered || null;
    step("registered under ~/.foundry (FOUNDRY_HOME)", {
      ok: Boolean(registered),
      message: registered
        ? `${registered.name} → ${registered.path}`
        : "missing from projects.json",
    });

    // Restart: kill and relaunch, reopen registry
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 400));
    const child2 = spawn(process.execPath, [path.join(root, "dist/index.js")], {
      cwd: root,
      env: { ...process.env, PORT: String(port), FOUNDRY_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await waitHealth();
      const again = await fetch(`${base}/api/projects`).then((r) => r.json());
      const still = (again.projects || []).find((p) => p.path === destination);
      step("restart reopens registered project", {
        ok: Boolean(still),
        message: still ? still.path : "not found after restart",
      });
    } finally {
      child2.kill("SIGTERM");
    }

    report.ok = report.steps.every((s) => s.ok);
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err));
    report.ok = false;
    console.error("ACCEPTANCE FAILED:", err);
    if (serverLog) console.error("--- server log ---\n", serverLog.slice(-2000));
  } finally {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    // Keep destination for inspection when GITHUB mode; otherwise clean homes
    if (!wantGithub) {
      await rm(home, { recursive: true, force: true }).catch(() => undefined);
      await rm(destRoot, { recursive: true, force: true }).catch(() => undefined);
    } else {
      console.log(`FOUNDRY_HOME kept: ${home}`);
      console.log(`Project kept: ${destination}`);
    }
  }

  console.log("\n=== ACCEPTANCE REPORT ===");
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
