import { describe, expect, it } from "vitest";
import {
  conflictAwareMergeInstruction,
  detectWorkerConflicts,
} from "../src/conflicts.js";
import type { WorkerResult } from "../src/types.js";

function worker(
  role: string,
  files: string[],
): WorkerResult {
  return {
    id: role,
    role,
    ok: true,
    summary: "ok",
    diffStat: "",
    filesChanged: files,
    stdout: "",
  };
}

describe("detectWorkerConflicts", () => {
  it("finds overlapping files", () => {
    const report = detectWorkerConflicts([
      worker("backend", ["src/auth.ts", "src/api.ts"]),
      worker("frontend", ["src/auth.ts", "src/ui.ts"]),
    ]);
    expect(report.clean).toBe(false);
    expect(report.conflicts[0]?.path).toBe("src/auth.ts");
    expect(report.conflicts[0]?.workers).toEqual(["backend", "frontend"]);
  });

  it("is clean when no overlap", () => {
    const report = detectWorkerConflicts([
      worker("backend", ["src/api.ts"]),
      worker("frontend", ["src/ui.ts"]),
    ]);
    expect(report.clean).toBe(true);
  });

  it("augments merge instructions on conflict", () => {
    const report = detectWorkerConflicts([
      worker("a", ["x.ts"]),
      worker("b", ["x.ts"]),
    ]);
    const merge = conflictAwareMergeInstruction("Merge please", report);
    expect(merge).toMatch(/CONFLICT HANDLING REQUIRED/);
  });
});
