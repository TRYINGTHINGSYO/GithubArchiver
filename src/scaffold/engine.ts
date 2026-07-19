import {
  access,
  cp,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  chmod,
} from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { foundryHome } from "../registry/projects.js";
import { buildTemplatePlan } from "./templates.js";
import type { ScaffoldRequest, ScaffoldResult } from "./types.js";

const execFileAsync = promisify(execFile);

async function run(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return { ok: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: `${e.stdout ?? ""}\n${e.stderr ?? e.message ?? String(err)}`.trim(),
    };
  }
}

function sanitizeName(name: string): string {
  const cleaned = name.trim().replace(/[<>:"|?*]/g, "");
  if (!cleaned) throw new Error("Project name is required");
  return cleaned;
}

/**
 * Scaffold into an isolated staging directory, verify, then move to destination.
 * On failure, staging is removed and destination is left untouched.
 */
export async function scaffoldProject(
  request: ScaffoldRequest,
): Promise<ScaffoldResult> {
  const name = sanitizeName(request.name);
  const destination = path.resolve(request.destination);
  const initGit = request.initGit !== false;
  const packageManager = request.packageManager ?? "npm";

  if (existsSync(destination)) {
    try {
      await access(destination, fsConstants.R_OK);
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(destination);
      if (entries.length > 0) {
        return {
          ok: false,
          stagingPath: "",
          filesCreated: 0,
          gitInitialized: false,
          initialCommit: false,
          installOk: false,
          verifySummary: "",
          message: `Destination is not empty: ${destination}`,
          error: "destination_conflict",
        };
      }
    } catch {
      // will create
    }
  }

  const stagingRoot = path.join(foundryHome(), "staging");
  await mkdir(stagingRoot, { recursive: true });
  const stagingPath = await mkdtemp(path.join(stagingRoot, `${name}-`));

  try {
    const plan = buildTemplatePlan(
      name,
      request.description || request.brief || name,
      request.template,
      packageManager,
    );

    // Optional: append brief as PROJECT.md for custom supervisor follow-up
    if (request.brief?.trim()) {
      plan.files.push({
        path: "PROJECT.md",
        content: `# ${name}\n\n## Brief\n\n${request.brief.trim()}\n`,
      });
    }

    for (const file of plan.files) {
      const full = path.join(stagingPath, file.path);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, file.content, "utf8");
      if (file.path.startsWith("bin/") && file.path.endsWith(".js")) {
        try {
          await chmod(full, 0o755);
        } catch {
          // windows
        }
      }
    }

    let gitInitialized = false;
    let initialCommit = false;
    if (initGit) {
      const gi = await run("git", ["init", "-b", "main"], stagingPath);
      if (!gi.ok) throw new Error(`git init failed: ${gi.output}`);
      gitInitialized = true;
    }

    const install = await run(
      packageManager,
      packageManager === "npm" ? ["install", "--no-fund", "--no-audit"] : ["install"],
      stagingPath,
    );

    const verifyLines: string[] = [];
    let verifyOk = true;
    for (const cmd of plan.verifyCommands) {
      const [bin, ...args] = cmd.split(/\s+/);
      const result = await run(bin, args, stagingPath);
      verifyLines.push(`${result.ok ? "✓" : "✗"} ${cmd}`);
      if (!result.ok) verifyOk = false;
    }

    if (!install.ok || !verifyOk) {
      const message = [
        "Scaffold verification failed — destination not written.",
        install.ok ? "" : `Install failed:\n${install.output.slice(0, 800)}`,
        verifyLines.join("\n"),
      ]
        .filter(Boolean)
        .join("\n");
      await rm(stagingPath, { recursive: true, force: true });
      return {
        ok: false,
        stagingPath: "",
        filesCreated: plan.files.length,
        gitInitialized,
        initialCommit,
        installOk: install.ok,
        verifySummary: verifyLines.join("\n"),
        message,
        error: "verify_failed",
      };
    }

    // Commit only after install + verify so lockfiles and verified tree are included.
    if (initGit) {
      await run("git", ["add", "."], stagingPath);
      const commit = await run(
        "git",
        [
          "-c",
          "user.email=foundry@localhost",
          "-c",
          "user.name=Foundry",
          "commit",
          "-m",
          "Initial project",
        ],
        stagingPath,
      );
      initialCommit = commit.ok;
      if (!commit.ok) {
        await run(
          "git",
          [
            "-c",
            "user.email=foundry@localhost",
            "-c",
            "user.name=Foundry",
            "commit",
            "--allow-empty",
            "-m",
            "Initial project",
          ],
          stagingPath,
        );
        initialCommit = true;
      }
    }

    await mkdir(path.dirname(destination), { recursive: true });
    if (existsSync(destination)) {
      await rm(destination, { recursive: true, force: true });
    }
    await cp(stagingPath, destination, { recursive: true });
    await rm(stagingPath, { recursive: true, force: true });

    const result: ScaffoldResult = {
      ok: true,
      stagingPath: "",
      destinationPath: destination,
      filesCreated: plan.files.length,
      gitInitialized,
      initialCommit,
      installOk: true,
      verifySummary: verifyLines.join("\n"),
      message: `Project created: ${destination}`,
    };

    if (request.createGithubRepo) {
      result.pendingGithub = {
        owner: request.githubOwner || process.env.GITHUB_OWNER || "local",
        name: name.replace(/[^\w.-]+/g, "-"),
        visibility: request.githubVisibility || "private",
        cwd: destination,
      };
      result.message +=
        "\nGitHub repository: Not created — awaiting approval";
    }

    return result;
  } catch (err) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
    return {
      ok: false,
      stagingPath: "",
      filesCreated: 0,
      gitInitialized: false,
      initialCommit: false,
      installOk: false,
      verifySummary: "",
      message: err instanceof Error ? err.message : String(err),
      error: "scaffold_failed",
    };
  }
}

/** Test helper: expose staging tmp under OS tmp when FOUNDRY_HOME unset in tests */
export function stagingBaseForTests(): string {
  return path.join(tmpdir(), "foundry-staging-test");
}
