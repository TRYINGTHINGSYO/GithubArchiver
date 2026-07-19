import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_VERSION = "0.5.0-beta.1";

/** Read package.json version (fallback to constant). */
export async function readPackageVersion(): Promise<string> {
  try {
    const raw = await readFile(path.resolve(__dirname, "../package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version || PACKAGE_VERSION;
  } catch {
    return PACKAGE_VERSION;
  }
}

/**
 * Lightweight update hint. When FOUNDRY_UPDATE_URL is set, compare remote
 * version string; otherwise report local-only (no network by default).
 */
export async function checkForUpdate(): Promise<{
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  message: string;
}> {
  const current = await readPackageVersion();
  const url = process.env.FOUNDRY_UPDATE_URL?.trim();
  if (!url) {
    return {
      current,
      latest: null,
      updateAvailable: false,
      message: `Foundry ${current} (set FOUNDRY_UPDATE_URL to enable update checks)`,
    };
  }
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { version?: string; latest?: string };
    const latest = body.latest || body.version || null;
    const updateAvailable = Boolean(latest && latest !== current);
    return {
      current,
      latest,
      updateAvailable,
      message: updateAvailable
        ? `Update available: ${current} → ${latest}`
        : `Foundry ${current} is up to date`,
    };
  } catch (err) {
    return {
      current,
      latest: null,
      updateAvailable: false,
      message: `Update check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
