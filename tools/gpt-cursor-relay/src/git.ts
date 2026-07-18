import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangedFile } from "./types.js";

const execFileAsync = promisify(execFile);

export async function listChangedFiles(projectPath: string): Promise<ChangedFile[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain"],
      { cwd: projectPath, maxBuffer: 2 * 1024 * 1024 },
    );

    return stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const status = line.slice(0, 2).trim() || "??";
        const path = line.slice(3).trim();
        return { status, path };
      });
  } catch {
    return [];
  }
}
