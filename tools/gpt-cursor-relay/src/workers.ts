import { mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { CursorRunner } from "./cursor.js";
import { collectGitSnapshot } from "./git.js";
import type { WorkerResult, WorkerSpec } from "./types.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as { stdout?: string };
    return e.stdout ?? "";
  }
}

export interface ParallelRunOptions {
  projectPath: string;
  workers: WorkerSpec[];
  cursor: CursorRunner;
  signal?: AbortSignal;
  onWorkerActivity?: (workerId: string, text: string) => void;
}

export async function runParallelWorkers(
  options: ParallelRunOptions,
): Promise<WorkerResult[]> {
  const base = path.join(options.projectPath, ".relay", "worktrees");
  await mkdir(base, { recursive: true });
  const head = (await git(options.projectPath, ["rev-parse", "HEAD"])).trim();

  const runs = options.workers.map(async (worker) => {
    const worktreePath = path.join(base, `${worker.id}-${sanitize(worker.role)}`);
    await rm(worktreePath, { recursive: true, force: true });
    try {
      await execFileAsync(
        "git",
        ["worktree", "add", "--detach", worktreePath, head || "HEAD"],
        { cwd: options.projectPath },
      );
    } catch (err) {
      return {
        id: worker.id,
        role: worker.role,
        ok: false,
        summary: `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
        diffStat: "",
        filesChanged: [],
        stdout: "",
        worktreePath,
      } satisfies WorkerResult;
    }

    const focus = worker.focus?.length
      ? `\nFocus areas: ${worker.focus.join(", ")}`
      : "";
    const instruction =
      `[Parallel worker: ${worker.role}]\n` +
      `Stay scoped to your role. Prefer not to rewrite unrelated areas.${focus}\n\n` +
      worker.instruction;

    const result = await options.cursor.run({
      projectPath: worktreePath,
      instruction,
      signal: options.signal,
      onActivity: (event) => {
        options.onWorkerActivity?.(worker.id, `[${worker.role}] ${event.text}`);
      },
    });

    const snap = await collectGitSnapshot(worktreePath);
    return {
      id: worker.id,
      role: worker.role,
      ok: result.ok,
      summary: result.stdout.slice(0, 1500) || result.stderr.slice(0, 800),
      diffStat: snap.diffStat,
      filesChanged: snap.files.map((f) => f.path),
      stdout: result.stdout,
      worktreePath,
    } satisfies WorkerResult;
  });

  return Promise.all(runs);
}

export async function cleanupWorkerTrees(
  projectPath: string,
  results: WorkerResult[],
): Promise<void> {
  for (const result of results) {
    if (!result.worktreePath) continue;
    try {
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", result.worktreePath],
        { cwd: projectPath },
      );
    } catch {
      await rm(result.worktreePath, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
  try {
    await execFileAsync("git", ["worktree", "prune"], { cwd: projectPath });
  } catch {
    // ignore
  }
}

export function formatWorkersForPrompt(results: WorkerResult[]): string {
  return results
    .map((r) => {
      return [
        `### Worker ${r.role} (${r.id}) ok=${r.ok}`,
        `Files: ${r.filesChanged.join(", ") || "(none)"}`,
        `Diff stat:\n${r.diffStat || "(empty)"}`,
        `Summary:\n${r.summary}`,
      ].join("\n");
    })
    .join("\n\n");
}

function sanitize(role: string): string {
  return role.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}
