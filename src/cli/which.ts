import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

/** Cross-platform which(1) */
export async function which(bin: string): Promise<string | null> {
  const pathEnv = process.env.PATH || process.env.Path || "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];

  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext.toLowerCase());
      try {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        try {
          await access(candidate, fsConstants.F_OK);
          return candidate;
        } catch {
          // continue
        }
      }
    }
  }
  return null;
}
