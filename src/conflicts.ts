import type { WorkerResult } from "./types.js";

export interface FileConflict {
  path: string;
  workers: string[];
}

export interface ConflictReport {
  conflicts: FileConflict[];
  clean: boolean;
  message: string;
}

/** Detect overlapping file edits across parallel workers before merge. */
export function detectWorkerConflicts(workers: WorkerResult[]): ConflictReport {
  const map = new Map<string, string[]>();
  for (const worker of workers) {
    for (const file of worker.filesChanged) {
      const list = map.get(file) ?? [];
      list.push(worker.role);
      map.set(file, list);
    }
  }

  const conflicts: FileConflict[] = [];
  for (const [filePath, roles] of map) {
    const unique = [...new Set(roles)];
    if (unique.length > 1) {
      conflicts.push({ path: filePath, workers: unique });
    }
  }

  if (!conflicts.length) {
    return {
      conflicts: [],
      clean: true,
      message: "No overlapping files across parallel workers",
    };
  }

  return {
    conflicts,
    clean: false,
    message:
      `File conflicts detected (${conflicts.length}):\n` +
      conflicts
        .map((c) => `• ${c.path} ← ${c.workers.join(", ")}`)
        .join("\n"),
  };
}

/**
 * Build a merge instruction that asks Cursor to reconcile conflicts
 * by preferring one role's version or regenerating the contested files.
 */
export function conflictAwareMergeInstruction(
  baseMerge: string,
  report: ConflictReport,
): string {
  if (report.clean) return baseMerge;
  return [
    baseMerge,
    "",
    "CONFLICT HANDLING REQUIRED:",
    report.message,
    "For each contested file:",
    "1. Inspect both worker versions if available in worktrees/.relay",
    "2. Produce one coherent merged file",
    "3. Do not silently drop either worker's intent without reason",
    "4. Re-run tests after reconciliation",
  ].join("\n");
}
