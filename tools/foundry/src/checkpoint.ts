import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { RollbackCheckpoint } from "./types.js";

const execFileAsync = promisify(execFile);

async function git(
  projectPath: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: projectPath,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(err),
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

/**
 * Capture a rollback point before an autonomous run.
 * Records HEAD and optionally stores a stash commit of the current dirty tree
 * without altering the working directory (`stash create` + `stash store`).
 */
export async function createCheckpoint(
  projectPath: string,
  label: string,
): Promise<RollbackCheckpoint> {
  const head = await git(projectPath, ["rev-parse", "HEAD"]);
  const headSha = head.stdout.trim() || "UNKNOWN";
  let stashRef: string | null = null;

  const status = await git(projectPath, ["status", "--porcelain"]);
  if (status.stdout.trim()) {
    const created = await git(projectPath, ["stash", "create"]);
    const oid = created.stdout.trim();
    if (created.code === 0 && oid) {
      stashRef = oid;
      await git(projectPath, [
        "stash",
        "store",
        "-m",
        `relay-checkpoint:${label}`,
        oid,
      ]);
    }
  }

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    projectPath,
    headSha,
    stashRef,
    label,
  };
}

/** Undo autonomous edits: hard-reset to checkpoint HEAD and remove untracked files. */
export async function rollbackToCheckpoint(
  checkpoint: RollbackCheckpoint,
): Promise<{ ok: boolean; message: string }> {
  const { projectPath, headSha } = checkpoint;
  if (!headSha || headSha === "UNKNOWN") {
    return { ok: false, message: "No valid checkpoint HEAD" };
  }

  const reset = await git(projectPath, ["reset", "--hard", headSha]);
  if (reset.code !== 0) {
    return {
      ok: false,
      message: `git reset --hard failed: ${reset.stderr || reset.stdout}`,
    };
  }
  const clean = await git(projectPath, ["clean", "-fd"]);
  if (clean.code !== 0) {
    return {
      ok: false,
      message: `git clean failed: ${clean.stderr || clean.stdout}`,
    };
  }

  return {
    ok: true,
    message: `Rolled back to ${headSha.slice(0, 8)}. Working tree cleaned.`,
  };
}
