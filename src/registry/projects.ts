import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export function foundryHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.FOUNDRY_HOME || path.join(homedir(), ".foundry");
}

export interface RegisteredProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  lastTask?: string;
  tags?: string[];
}

export interface ProjectRegistry {
  version: 1;
  projects: RegisteredProject[];
}

function registryPath(home = foundryHome()): string {
  return path.join(home, "projects.json");
}

export async function loadRegistry(
  home = foundryHome(),
): Promise<ProjectRegistry> {
  try {
    const raw = await readFile(registryPath(home), "utf8");
    const parsed = JSON.parse(raw) as ProjectRegistry;
    if (parsed.version !== 1 || !Array.isArray(parsed.projects)) {
      return { version: 1, projects: [] };
    }
    return parsed;
  } catch {
    return { version: 1, projects: [] };
  }
}

export async function saveRegistry(
  registry: ProjectRegistry,
  home = foundryHome(),
): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(registryPath(home), JSON.stringify(registry, null, 2), "utf8");
}

export async function upsertProject(
  entry: Omit<RegisteredProject, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
  },
  home = foundryHome(),
): Promise<RegisteredProject> {
  const registry = await loadRegistry(home);
  const now = new Date().toISOString();
  const existing = registry.projects.find(
    (p) => p.path === entry.path || p.name === entry.name,
  );
  if (existing) {
    existing.name = entry.name;
    existing.path = entry.path;
    existing.updatedAt = now;
    if (entry.lastTask) existing.lastTask = entry.lastTask;
    if (entry.tags) existing.tags = entry.tags;
    await saveRegistry(registry, home);
    return existing;
  }
  const created: RegisteredProject = {
    id: entry.id || cryptoRandomId(),
    name: entry.name,
    path: entry.path,
    createdAt: now,
    updatedAt: now,
    lastTask: entry.lastTask,
    tags: entry.tags,
  };
  registry.projects.push(created);
  await saveRegistry(registry, home);
  return created;
}

function cryptoRandomId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Merge registry paths into the known-projects map (registry wins on name clash). */
export async function registryAsKnownMap(
  home = foundryHome(),
): Promise<Record<string, string>> {
  const reg = await loadRegistry(home);
  const map: Record<string, string> = {};
  for (const p of reg.projects) map[p.name] = p.path;
  return map;
}
