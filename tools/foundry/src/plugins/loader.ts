import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BUILTIN_PLUGINS } from "./builtin.js";
import type { OrchestratorPlugin } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LoadedPlugins {
  active: OrchestratorPlugin[];
  available: string[];
  source: "config" | "autodetect" | "none";
}

/** Discover built-ins + optional external plugins from tools/.../plugins or project .foundry/plugins */
export async function discoverPlugins(
  projectPath: string,
  requested: string[],
): Promise<LoadedPlugins> {
  const registry = new Map<string, OrchestratorPlugin>();
  for (const plugin of BUILTIN_PLUGINS) {
    registry.set(plugin.id, plugin);
  }

  // External plugin folders (each may export default plugin via plugin.js/mjs/ts compiled)
  const searchDirs = [
    path.resolve(__dirname, "../../plugins"),
    path.join(projectPath, ".foundry", "plugins"),
    path.join(projectPath, ".relay", "plugins"), // legacy
    path.join(projectPath, "plugins"),
  ];

  for (const dir of searchDirs) {
    await loadExternalDir(dir, registry);
  }

  const available = [...registry.keys()].sort();

  if (requested.length > 0) {
    const active = requested
      .map((id) => registry.get(id))
      .filter((p): p is OrchestratorPlugin => Boolean(p));
    return { active, available, source: "config" };
  }

  // Auto-detect
  const active: OrchestratorPlugin[] = [];
  for (const plugin of registry.values()) {
    if (!plugin.autoDetect) continue;
    try {
      if (await plugin.autoDetect(projectPath)) active.push(plugin);
    } catch {
      // ignore detect failures
    }
  }
  return {
    active,
    available,
    source: active.length ? "autodetect" : "none",
  };
}

async function loadExternalDir(
  dir: string,
  registry: Map<string, OrchestratorPlugin>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    // Prefer manifest JSON for zero-exec discovery; optional JS module.
    const folder = path.join(dir, entry.name);
    const manifestPath = path.join(folder, "plugin.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        id?: string;
        name?: string;
        verifyCommands?: Array<{ name: string; command: string }>;
      };
      const id = manifest.id || entry.name;
      registry.set(id, {
        id,
        name: manifest.name || id,
        async verifyCommands() {
          return manifest.verifyCommands ?? [];
        },
      });
      continue;
    } catch {
      // try module
    }

    for (const file of ["plugin.js", "index.js", "plugin.mjs"]) {
      const modPath = path.join(folder, file);
      try {
        const mod = (await import(pathToFileURL(modPath).href)) as {
          default?: OrchestratorPlugin;
          plugin?: OrchestratorPlugin;
        };
        const plugin = mod.default || mod.plugin;
        if (plugin?.id) registry.set(plugin.id, plugin);
        break;
      } catch {
        // ignore
      }
    }
  }
}
