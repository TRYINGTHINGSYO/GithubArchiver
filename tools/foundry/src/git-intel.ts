import type { GptClient } from "./gpt.js";
import type { GitIntelligence, GitSnapshot } from "./types.js";

export function heuristicGitIntel(git: GitSnapshot): GitIntelligence {
  const bullets = git.files.slice(0, 12).map((f) => {
    const mark =
      f.kind === "added"
        ? "+"
        : f.kind === "removed"
          ? "-"
          : f.kind === "untracked"
            ? "?"
            : "~";
    const base = pathBasename(f.path);
    return `${mark} ${humanize(base)} (${f.path})`;
  });

  const theme = inferTheme(git.files.map((f) => f.path));
  const risky = git.files.some((f) =>
    /\b(migration|auth|schema|middleware|\.env)\b/i.test(f.path),
  );

  return {
    theme,
    bullets: bullets.length ? bullets : ["(no file changes)"],
    risk: risky ? "medium" : git.files.length > 20 ? "medium" : "low",
    breakingChanges: risky ? "Possible — review auth/schema/migrations" : "None detected",
    migration: git.files.some((f) => /migration/i.test(f.path))
      ? "Yes — migration files touched"
      : "No",
  };
}

export async function enrichGitIntel(
  gpt: GptClient,
  git: GitSnapshot,
): Promise<GitIntelligence> {
  const base = heuristicGitIntel(git);
  if (!git.files.length) return base;
  try {
    return await gpt.analyzeGit({
      statusText: git.statusText,
      diffStat: git.diffStat,
      diffPatch: git.diffPatch.slice(0, 20_000),
      heuristic: base,
    });
  } catch {
    return base;
  }
}

function pathBasename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function humanize(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferTheme(paths: string[]): string {
  const joined = paths.join(" ");
  if (/auth|login|session|jwt/i.test(joined)) return "Authentication";
  if (/test|spec|vitest|playwright/i.test(joined)) return "Tests";
  if (/route|page|component|svelte|react/i.test(joined)) return "UI / routes";
  if (/migrat|schema|sql|db/i.test(joined)) return "Database";
  if (/doc|readme|md/i.test(joined)) return "Documentation";
  if (!paths.length) return "No changes";
  return "Implementation";
}
