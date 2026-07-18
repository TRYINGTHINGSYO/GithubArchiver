import { describe, expect, it } from "vitest";
import { shouldSuperviseActivity } from "../src/supervisor.js";

describe("shouldSuperviseActivity", () => {
  it("watches edits and sensitive paths", () => {
    expect(shouldSuperviseActivity("Editing src/auth.ts")).toBe(true);
    expect(shouldSuperviseActivity("Editing src/lib/session.ts")).toBe(true);
    expect(shouldSuperviseActivity("Running git push origin HEAD")).toBe(true);
  });

  it("ignores mundane reads", () => {
    // Reading is still returned true by path? "Reading x" - shouldSupervise checks Editing first
    expect(shouldSuperviseActivity("Reading README.md")).toBe(false);
  });
});
