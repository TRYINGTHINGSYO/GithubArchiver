import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangedFile, DiffFile, DiffLine, GitSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);

async function git(
  projectPath: string,
  args: string[],
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: projectPath,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    if (typeof e.stdout === "string") return e.stdout;
    return "";
  }
}

function classifyStatus(code: string): ChangedFile["kind"] {
  const c = code.trim();
  if (c === "??") return "untracked";
  if (c === "A" || c.endsWith("A")) return "added";
  if (c === "D" || c.endsWith("D")) return "removed";
  if (c.includes("R")) return "renamed";
  if (c === "M" || c.includes("M")) return "modified";
  return "other";
}

export function parsePorcelain(statusText: string): ChangedFile[] {
  return statusText
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      let filePath = line.slice(3).trim();
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").at(-1)?.trim() ?? filePath;
      }
      return {
        status: status.trim() || "??",
        path: filePath,
        kind: classifyStatus(status),
      };
    });
}

export function parseDiffPatch(patch: string): DiffFile[] {
  if (!patch.trim()) return [];
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const rawLine of patch.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      const match = rawLine.match(/diff --git a\/(.+) b\/(.+)/);
      const filePath = match?.[2] ?? "unknown";
      current = {
        path: filePath,
        status: "M",
        kind: "modified",
        additions: 0,
        deletions: 0,
        lines: [{ type: "meta", text: rawLine }],
      };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (rawLine.startsWith("new file mode")) {
      current.kind = "added";
      current.status = "A";
      current.lines.push({ type: "meta", text: rawLine });
    } else if (rawLine.startsWith("deleted file mode")) {
      current.kind = "removed";
      current.status = "D";
      current.lines.push({ type: "meta", text: rawLine });
    } else if (rawLine.startsWith("@@")) {
      current.lines.push({ type: "hunk", text: rawLine });
    } else if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      current.additions += 1;
      current.lines.push({ type: "add", text: rawLine });
    } else if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      current.deletions += 1;
      current.lines.push({ type: "del", text: rawLine });
    } else if (rawLine.startsWith("+++") || rawLine.startsWith("---")) {
      current.lines.push({ type: "meta", text: rawLine });
    } else {
      current.lines.push({ type: "ctx", text: rawLine });
    }
  }

  // Cap lines per file for UI
  for (const file of files) {
    if (file.lines.length > 400) {
      file.lines = [
        ...file.lines.slice(0, 400),
        { type: "meta", text: `… truncated ${file.lines.length - 400} lines …` },
      ];
    }
  }
  return files;
}

function hashDiff(patch: string): string {
  if (!patch.trim()) return "";
  return createHash("sha256").update(patch).digest("hex").slice(0, 16);
}

export async function collectGitSnapshot(
  projectPath: string,
): Promise<GitSnapshot> {
  const [statusText, diffStat, unstaged, staged, untrackedNames] =
    await Promise.all([
      git(projectPath, ["status", "--porcelain"]),
      git(projectPath, ["diff", "--stat", "HEAD"]),
      git(projectPath, ["diff", "HEAD"]),
      git(projectPath, ["diff", "--cached"]),
      git(projectPath, ["ls-files", "--others", "--exclude-standard"]),
    ]);

  let diffPatch = [staged, unstaged].filter(Boolean).join("\n");
  // Include short untracked listing so GPT knows new files exist.
  if (untrackedNames.trim()) {
    const note = untrackedNames
      .split("\n")
      .filter(Boolean)
      .map((p) => `??? ${p}`)
      .join("\n");
    diffPatch = `${diffPatch}\n\n# Untracked files:\n${note}`.trim();
  }

  const files = parsePorcelain(statusText);
  const diffFiles = parseDiffPatch(diffPatch);
  // Prefer kind from porcelain when available
  for (const df of diffFiles) {
    const match = files.find((f) => f.path === df.path);
    if (match) {
      df.kind = match.kind;
      df.status = match.status;
    }
  }

  const additions = diffFiles.reduce((n, f) => n + f.additions, 0);
  const deletions = diffFiles.reduce((n, f) => n + f.deletions, 0);

  return {
    statusText: statusText.trim(),
    diffStat: diffStat.trim(),
    diffPatch: truncate(diffPatch.trim(), 80_000),
    files,
    diffFiles,
    additions,
    deletions,
    diffHash: hashDiff(diffPatch),
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n… truncated for prompt size …`;
}

export async function listChangedFiles(
  projectPath: string,
): Promise<ChangedFile[]> {
  const statusText = await git(projectPath, ["status", "--porcelain"]);
  return parsePorcelain(statusText);
}

export function formatGitForPrompt(snapshot: GitSnapshot): string {
  return [
    "git status --porcelain:",
    snapshot.statusText || "(clean)",
    "",
    "git diff --stat:",
    snapshot.diffStat || "(no stat)",
    "",
    "git diff (patch):",
    snapshot.diffPatch || "(empty)",
  ].join("\n");
}

export type { DiffLine };
