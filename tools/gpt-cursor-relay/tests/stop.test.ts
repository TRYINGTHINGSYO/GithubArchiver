import { describe, expect, it } from "vitest";
import { evaluateStopConditions, shouldRetryCursor } from "../src/stop.js";
import type { GitSnapshot } from "../src/types.js";

const git = (hash: string, files = 1): GitSnapshot => ({
  statusText: files ? " M file.ts" : "",
  diffStat: files ? " 1 file changed" : "",
  diffPatch: files ? "diff --git a/file.ts b/file.ts\n+hi" : "",
  files: files
    ? [{ path: "file.ts", status: "M", kind: "modified" }]
    : [],
  diffFiles: [],
  additions: files,
  deletions: 0,
  diffHash: hash,
});

describe("evaluateStopConditions", () => {
  it("stops on duplicate instruction", () => {
    const result = evaluateStopConditions({
      round: 2,
      maxRounds: 8,
      instruction: "Fix the bug in page.svelte",
      previousInstructions: ["Fix the bug in page.svelte"],
      git: git("aaa"),
      previousDiffHash: "bbb",
      expectChanges: true,
      noChangeStreak: 0,
      testHistory: [],
      cursorOk: true,
      cursorText: "",
      rounds: [],
    });
    expect(result.stop).toBe(true);
    expect(result.code).toBe("duplicate_instruction");
  });

  it("stops on identical diff", () => {
    const result = evaluateStopConditions({
      round: 3,
      maxRounds: 8,
      instruction: "Try another approach",
      previousInstructions: ["first"],
      git: git("samehash"),
      previousDiffHash: "samehash",
      expectChanges: true,
      noChangeStreak: 0,
      testHistory: [],
      cursorOk: true,
      cursorText: "",
      rounds: [],
    });
    expect(result.stop).toBe(true);
    expect(result.code).toBe("identical_diff");
  });

  it("stops after repeated no file changes", () => {
    const result = evaluateStopConditions({
      round: 3,
      maxRounds: 8,
      instruction: "keep going",
      previousInstructions: ["a"],
      git: git("", 0),
      previousDiffHash: null,
      expectChanges: true,
      noChangeStreak: 2,
      testHistory: [],
      cursorOk: true,
      cursorText: "",
      rounds: [],
    });
    expect(result.stop).toBe(true);
    expect(result.code).toBe("no_file_changes");
  });

  it("stops on same test failure three times", () => {
    const result = evaluateStopConditions({
      round: 4,
      maxRounds: 8,
      instruction: "fix tests",
      previousInstructions: ["a"],
      git: git("x"),
      previousDiffHash: "y",
      expectChanges: true,
      noChangeStreak: 0,
      testHistory: ["2 failed", "2 failed", "2 failed"],
      cursorOk: false,
      cursorText: "",
      rounds: [],
    });
    expect(result.stop).toBe(true);
    expect(result.code).toBe("repeated_test_failure");
  });
});

describe("shouldRetryCursor", () => {
  it("retries crashes", () => {
    expect(
      shouldRetryCursor({
        crashed: true,
        ok: false,
        timedOut: false,
        exitCode: null,
        stdout: "",
        stderr: "spawn agent ENOENT",
      }),
    ).toBe(true);
  });

  it("does not retry timeouts", () => {
    expect(
      shouldRetryCursor({
        crashed: false,
        ok: false,
        timedOut: true,
        exitCode: null,
        stdout: "",
        stderr: "",
      }),
    ).toBe(false);
  });
});
