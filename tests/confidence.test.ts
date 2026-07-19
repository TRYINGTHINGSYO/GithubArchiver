import { describe, expect, it } from "vitest";
import { scoreCompletion } from "../src/confidence.js";

describe("completion confidence", () => {
  it("scores higher when verification passes", () => {
    const high = scoreCompletion({
      verification: {
        ok: true,
        commands: [
          { name: "test", command: "npm test", ok: true, exitCode: 0, output: "", durationMs: 10 },
          { name: "typecheck", command: "tsc", ok: true, exitCode: 0, output: "", durationMs: 10 },
        ],
        summary: "ok",
      },
      git: {
        statusText: "",
        diffStat: "1 file",
        diffPatch: "",
        files: [{ path: "a.ts", status: "M", kind: "modified" }],
        diffFiles: [],
        additions: 10,
        deletions: 2,
        diffHash: "x",
      },
    });
    const low = scoreCompletion({
      verification: null,
      git: null,
    });
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.evidence.some((e) => e.label === "test" && e.ok)).toBe(true);
  });
});
