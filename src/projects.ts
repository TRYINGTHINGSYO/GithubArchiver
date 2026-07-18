import { access, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import type { DetectedProject } from "./types.js";

export interface ProjectCatalog {
  /** Explicit name → absolute path */
  known: Record<string, string>;
  /** Directories to scan for project folders */
  searchRoots: string[];
}

const DEFAULT_HINTS: Array<{ name: string; patterns: RegExp[] }> = [
  {
    name: "GithubArchiver",
    patterns: [/github\s*archiv/i, /githubarchiv/i, /cluster link/i, /gh archive/i],
  },
  {
    name: "SiegeQueue",
    patterns: [/siege\s*queue/i, /siegequeue/i, /mobile overlay/i],
  },
];

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function discoverFromRoots(
  roots: string[],
): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        const full = path.join(root, entry.name);
        found[entry.name] = full;
      }
    } catch {
      // ignore unreadable roots
    }
  }
  return found;
}

export async function buildProjectIndex(
  catalog: ProjectCatalog,
): Promise<Record<string, string>> {
  const discovered = await discoverFromRoots(catalog.searchRoots);
  return { ...discovered, ...catalog.known };
}

export function detectProjectsFromTask(
  task: string,
  index: Record<string, string>,
): DetectedProject[] {
  const hits: DetectedProject[] = [];
  const lowerTask = task.toLowerCase();

  for (const [name, projectPath] of Object.entries(index)) {
    const nameLower = name.toLowerCase();
    if (lowerTask.includes(nameLower)) {
      hits.push({
        name,
        path: projectPath,
        confidence: 0.95,
        reason: `Task mentions "${name}"`,
      });
      continue;
    }
    // kebab/snake variants
    const compact = nameLower.replace(/[^a-z0-9]/g, "");
    if (compact && lowerTask.replace(/[^a-z0-9]/g, "").includes(compact)) {
      hits.push({
        name,
        path: projectPath,
        confidence: 0.85,
        reason: `Task matches project name variant for "${name}"`,
      });
    }
  }

  for (const hint of DEFAULT_HINTS) {
    if (hits.some((h) => h.name.toLowerCase() === hint.name.toLowerCase())) {
      continue;
    }
    if (!hint.patterns.some((p) => p.test(task))) continue;
    const matchKey = Object.keys(index).find(
      (k) => k.toLowerCase() === hint.name.toLowerCase(),
    );
    if (!matchKey) continue;
    hits.push({
      name: matchKey,
      path: index[matchKey],
      confidence: 0.75,
      reason: `Task matches known patterns for ${hint.name}`,
    });
  }

  return hits.sort((a, b) => b.confidence - a.confidence);
}

export function defaultSearchRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots: string[] = [];
  const projectRoots = env.FOUNDRY_PROJECT_ROOTS || env.RELAY_PROJECT_ROOTS;
  if (projectRoots) {
    roots.push(
      ...projectRoots
        .split(path.delimiter)
        .map((p) => p.trim())
        .filter(Boolean),
    );
  }
  if (env.HOME) {
    roots.push(path.join(env.HOME, "Projects"));
    roots.push(path.join(env.HOME, "Developer"));
    roots.push(path.join(env.HOME, "code"));
    roots.push(path.join(env.HOME, "src"));
  }
  // Common cloud/workspace locations
  roots.push("/workspace");
  roots.push(path.resolve(process.cwd(), ".."));
  roots.push(process.cwd());
  return [...new Set(roots)];
}

export function parseKnownProjects(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const raw = env.FOUNDRY_KNOWN_PROJECTS || env.RELAY_KNOWN_PROJECTS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
