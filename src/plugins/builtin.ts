import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import type { OrchestratorPlugin, PluginContext, PluginVerifyResult } from "./types.js";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readPkg(projectPath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(
      await readFile(path.join(projectPath, "package.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasDep(pkg: Record<string, unknown> | null, name: string): boolean {
  if (!pkg) return false;
  const all = {
    ...(pkg.dependencies as object),
    ...(pkg.devDependencies as object),
  };
  return name in all;
}

export const sqlitePlugin: OrchestratorPlugin = {
  id: "sqlite",
  name: "SQLite",
  description: "Detects SQLite usage and suggests db status checks",
  async autoDetect(projectPath) {
    const pkg = await readPkg(projectPath);
    if (hasDep(pkg, "better-sqlite3") || hasDep(pkg, "sqlite3")) return true;
    return (
      (await exists(path.join(projectPath, "data"))) ||
      (await exists(path.join(projectPath, "db")))
    );
  },
  async verifyCommands(ctx) {
    const pkg = await readPkg(ctx.projectPath);
    const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
    const cmds = [];
    if (scripts["db:status"]) {
      cmds.push({ name: "sqlite:db-status", command: "npm run db:status" });
    }
    return cmds;
  },
};

export const railwayPlugin: OrchestratorPlugin = {
  id: "railway",
  name: "Railway",
  description: "Railway deploy project detection",
  async autoDetect(projectPath) {
    return (
      (await exists(path.join(projectPath, "railway.toml"))) ||
      (await exists(path.join(projectPath, "railway.json")))
    );
  },
  async verifyCommands() {
    // Non-destructive: only check CLI presence if available
    return [{ name: "railway:whoami", command: "railway whoami || true" }];
  },
};

export const playwrightPlugin: OrchestratorPlugin = {
  id: "playwright",
  name: "Playwright",
  description: "Runs Playwright tests when configured",
  async autoDetect(projectPath) {
    const pkg = await readPkg(projectPath);
    return (
      hasDep(pkg, "@playwright/test") ||
      (await exists(path.join(projectPath, "playwright.config.ts"))) ||
      (await exists(path.join(projectPath, "playwright.config.js")))
    );
  },
  async verifyCommands(ctx) {
    const pkg = await readPkg(ctx.projectPath);
    const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
    if (scripts["test:e2e"]) {
      return [{ name: "playwright:e2e", command: "npm run test:e2e" }];
    }
    if (hasDep(pkg, "@playwright/test")) {
      return [{ name: "playwright:test", command: "npx playwright test" }];
    }
    return [];
  },
};

export const githubPlugin: OrchestratorPlugin = {
  id: "github",
  name: "GitHub",
  description: "GitHub Actions / gh CLI awareness",
  async autoDetect(projectPath) {
    return exists(path.join(projectPath, ".github"));
  },
  async verifyCommands() {
    return [];
  },
};

export const vercelPlugin: OrchestratorPlugin = {
  id: "vercel",
  name: "Vercel",
  async autoDetect(projectPath) {
    return (
      (await exists(path.join(projectPath, "vercel.json"))) ||
      (await exists(path.join(projectPath, ".vercel")))
    );
  },
};

export const dockerPlugin: OrchestratorPlugin = {
  id: "docker",
  name: "Docker",
  async autoDetect(projectPath) {
    return (
      (await exists(path.join(projectPath, "Dockerfile"))) ||
      (await exists(path.join(projectPath, "docker-compose.yml"))) ||
      (await exists(path.join(projectPath, "compose.yml")))
    );
  },
  async verifyCommands() {
    return [
      {
        name: "docker:compose-config",
        command:
          "(test -f docker-compose.yml || test -f compose.yml) && docker compose config -q || true",
      },
    ];
  },
};

export const supabasePlugin: OrchestratorPlugin = {
  id: "supabase",
  name: "Supabase",
  async autoDetect(projectPath) {
    return (
      (await exists(path.join(projectPath, "supabase"))) ||
      (await exists(path.join(projectPath, "supabase/config.toml")))
    );
  },
};

export const customPlugin: OrchestratorPlugin = {
  id: "custom",
  name: "Custom",
  description: "Loads verify scripts from package.json relay:verify if present",
  async autoDetect(projectPath) {
    const pkg = await readPkg(projectPath);
    const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
    return Boolean(scripts["relay:verify"] || scripts["verify"]);
  },
  async verifyCommands(ctx) {
    const pkg = await readPkg(ctx.projectPath);
    const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
    if (scripts["relay:verify"]) {
      return [{ name: "custom:relay-verify", command: "npm run relay:verify" }];
    }
    if (scripts.verify) {
      return [{ name: "custom:verify", command: "npm run verify" }];
    }
    return [];
  },
  async verify(_ctx: PluginContext): Promise<PluginVerifyResult | null> {
    return null;
  },
};

export const BUILTIN_PLUGINS: OrchestratorPlugin[] = [
  sqlitePlugin,
  railwayPlugin,
  playwrightPlugin,
  githubPlugin,
  vercelPlugin,
  dockerPlugin,
  supabasePlugin,
  customPlugin,
];
