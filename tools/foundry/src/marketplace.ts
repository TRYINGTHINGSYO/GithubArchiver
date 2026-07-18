import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_PLUGINS } from "./plugins/builtin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface MarketplacePlugin {
  id: string;
  name: string;
  description: string;
  category: string;
  source: "builtin" | "local" | "registry";
  version: string;
  installed: boolean;
}

/** Local plugin registry (marketplace seed). Remote registry can replace this later. */
export const REGISTRY_CATALOG: Array<Omit<MarketplacePlugin, "installed" | "source">> = [
  {
    id: "sqlite",
    name: "SQLite",
    description: "DB status checks for SQLite / better-sqlite3 projects",
    category: "data",
    version: "1.0.0",
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "E2E browser test verification",
    category: "testing",
    version: "1.0.0",
  },
  {
    id: "docker",
    name: "Docker",
    description: "Compose config validation",
    category: "infra",
    version: "1.0.0",
  },
  {
    id: "railway",
    name: "Railway",
    description: "Railway project detection & auth check",
    category: "deploy",
    version: "1.0.0",
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Vercel project detection",
    category: "deploy",
    version: "1.0.0",
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Supabase project detection",
    category: "data",
    version: "1.0.0",
  },
  {
    id: "github",
    name: "GitHub",
    description: "GitHub Actions awareness",
    category: "scm",
    version: "1.0.0",
  },
  {
    id: "svelte",
    name: "Svelte",
    description: "SvelteKit check/build helpers (marketplace stub)",
    category: "frontend",
    version: "0.1.0",
  },
  {
    id: "react",
    name: "React",
    description: "React/Vite verification helpers (marketplace stub)",
    category: "frontend",
    version: "0.1.0",
  },
  {
    id: "unity",
    name: "Unity",
    description: "Unity project detection (marketplace stub)",
    category: "game",
    version: "0.1.0",
  },
];

export async function listMarketplace(): Promise<MarketplacePlugin[]> {
  const builtinIds = new Set(BUILTIN_PLUGINS.map((p) => p.id));
  return REGISTRY_CATALOG.map((p) => ({
    ...p,
    source: builtinIds.has(p.id) ? "builtin" : "registry",
    installed: builtinIds.has(p.id),
  }));
}

/** Install a registry stub plugin as local plugin.json under tools/foundry/plugins */
export async function installMarketplacePlugin(id: string): Promise<{
  ok: boolean;
  path?: string;
  message: string;
}> {
  const entry = REGISTRY_CATALOG.find((p) => p.id === id);
  if (!entry) {
    return { ok: false, message: `Unknown plugin: ${id}` };
  }
  if (BUILTIN_PLUGINS.some((p) => p.id === id)) {
    return { ok: true, message: `${id} is already a built-in plugin` };
  }

  const dir = path.resolve(__dirname, `../../plugins/${id}`);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "plugin.json");
  await writeFile(
    file,
    JSON.stringify(
      {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        version: entry.version,
        verifyCommands: [],
      },
      null,
      2,
    ),
    "utf8",
  );
  return { ok: true, path: file, message: `Installed stub plugin to ${file}` };
}

export async function readInstalledManifest(id: string): Promise<unknown | null> {
  try {
    const file = path.resolve(__dirname, `../../plugins/${id}/plugin.json`);
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}
