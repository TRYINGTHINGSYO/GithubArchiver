import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CodingStylePrefs,
  ProjectLongMemory,
  SessionMemory,
} from "./types.js";

function memoryRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RELAY_MEMORY_DIR) return env.RELAY_MEMORY_DIR;
  const home = env.HOME || env.USERPROFILE || process.cwd();
  return path.join(home, ".gpt-cursor-relay");
}

function projectKey(projectPath: string): string {
  return projectPath.replace(/[\\/:*?"<>|]/g, "_");
}

export function defaultStyle(): CodingStylePrefs {
  return {
    prefers: [],
    avoids: [],
    notes: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function loadProjectMemory(
  projectPath: string,
): Promise<ProjectLongMemory> {
  const file = path.join(
    memoryRoot(),
    "projects",
    `${projectKey(projectPath)}.json`,
  );
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as ProjectLongMemory;
    return {
      projectPath,
      projectName: parsed.projectName || path.basename(projectPath),
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      style: parsed.style ?? defaultStyle(),
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
    };
  } catch {
    return {
      projectPath,
      projectName: path.basename(projectPath),
      sessions: [],
      style: defaultStyle(),
      facts: [],
    };
  }
}

export async function saveProjectMemory(
  memory: ProjectLongMemory,
): Promise<void> {
  const dir = path.join(memoryRoot(), "projects");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${projectKey(memory.projectPath)}.json`);
  // Bound growth
  const trimmed: ProjectLongMemory = {
    ...memory,
    sessions: memory.sessions.slice(-40),
    facts: memory.facts.slice(-80),
    style: {
      ...memory.style,
      prefers: memory.style.prefers.slice(-40),
      avoids: memory.style.avoids.slice(-40),
      notes: memory.style.notes.slice(-40),
    },
  };
  await writeFile(file, JSON.stringify(trimmed, null, 2), "utf8");
}

export async function rememberSessionEnd(
  projectPath: string,
  session: SessionMemory,
  summary: string | null,
): Promise<ProjectLongMemory> {
  const long = await loadProjectMemory(projectPath);
  long.sessions.push({
    id: `${Date.now()}`,
    task: session.task,
    startedAt: session.startedAt,
    summary: summary ?? undefined,
    decisions: session.decisions.slice(-20),
  });
  // Learn style hints from decisions mentioning preferences
  for (const d of session.decisions) {
    learnStyleFromText(long.style, d);
  }
  if (summary) {
    learnStyleFromText(long.style, summary);
    if (!long.facts.includes(summary.slice(0, 240))) {
      long.facts.push(`Session: ${session.task} → ${summary.slice(0, 200)}`);
    }
  }
  long.style.updatedAt = new Date().toISOString();
  await saveProjectMemory(long);
  return long;
}

export function learnStyleFromText(
  style: CodingStylePrefs,
  text: string,
): void {
  const lower = text.toLowerCase();
  const preferPatterns: Array<[RegExp, string]> = [
    [/\bsvelte(kit)?\b/i, "Svelte / SvelteKit"],
    [/\bsqlite\b/i, "SQLite"],
    [/\bfast pages?\b/i, "Fast pages"],
    [/\bone[- ]file util/i, "One-file utilities"],
    [/\bsimple sql\b/i, "Simple SQL"],
    [/\bno unnecessary abstraction/i, "No unnecessary abstractions"],
    [/\bprefer(?:s)?\s+([^.!\n]{3,60})/i, ""],
  ];
  for (const [re, label] of preferPatterns) {
    const m = text.match(re);
    if (!m) continue;
    const value = label || m[1]?.trim();
    if (value && !style.prefers.includes(value)) style.prefers.push(value);
  }
  if (/\bavoid\b|\bdon't\b|\bdo not\b/i.test(lower)) {
    const m = text.match(/\b(?:avoid|don't|do not)\s+([^.!\n]{3,60})/i);
    if (m?.[1] && !style.avoids.includes(m[1].trim())) {
      style.avoids.push(m[1].trim());
    }
  }
}

export function formatStyleForPrompt(style: CodingStylePrefs): string {
  return [
    "Coding style preferences:",
    style.prefers.length
      ? style.prefers.map((p) => `✓ ${p}`).join("\n")
      : "✓ (none recorded yet)",
    style.avoids.length
      ? style.avoids.map((a) => `✗ avoid ${a}`).join("\n")
      : "",
    style.notes.length ? style.notes.map((n) => `• ${n}`).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatLongMemoryForPrompt(long: ProjectLongMemory): string {
  const recent = long.sessions.slice(-8).map((s) => {
    const sum = s.summary ? ` → ${s.summary.slice(0, 160)}` : "";
    return `- ${s.startedAt.slice(0, 10)}: ${s.task}${sum}`;
  });
  return [
    "Long-term project memory:",
    recent.length ? recent.join("\n") : "- (no prior sessions)",
    "",
    "Known facts:",
    long.facts.length
      ? long.facts.slice(-12).map((f) => `- ${f}`).join("\n")
      : "- (none)",
    "",
    formatStyleForPrompt(long.style),
  ].join("\n");
}
