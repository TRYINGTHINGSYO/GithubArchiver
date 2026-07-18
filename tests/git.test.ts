import { describe, expect, it } from "vitest";
import { parseDiffPatch, parsePorcelain } from "../src/git.js";

describe("git parsers", () => {
  it("classifies porcelain statuses", () => {
    const files = parsePorcelain(" M src/a.ts\n?? new.ts\nD  gone.ts\n");
    expect(files).toEqual([
      { status: "M", path: "src/a.ts", kind: "modified" },
      { status: "??", path: "new.ts", kind: "untracked" },
      { status: "D", path: "gone.ts", kind: "removed" },
    ]);
  });

  it("parses visual diff lines", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,3 @@",
      " keep",
      "-old",
      "+new",
      "+extra",
    ].join("\n");
    const files = parseDiffPatch(patch);
    expect(files).toHaveLength(1);
    expect(files[0]?.additions).toBe(2);
    expect(files[0]?.deletions).toBe(1);
    expect(files[0]?.lines.some((l) => l.type === "add")).toBe(true);
    expect(files[0]?.lines.some((l) => l.type === "del")).toBe(true);
  });
});
