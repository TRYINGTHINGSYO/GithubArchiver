import { describe, expect, it } from "vitest";
import { parseGptDecision } from "../src/gpt.js";

describe("parseGptDecision", () => {
  it("parses continue", () => {
    const decision = parseGptDecision({
      status: "continue",
      instruction: "Add a failing test first",
      notes: "start with repro",
    });
    expect(decision.status).toBe("continue");
    expect(decision.instruction).toContain("failing test");
  });

  it("requires summary on complete", () => {
    expect(() => parseGptDecision({ status: "complete" })).toThrow(/summary/);
  });

  it("requires question on ask", () => {
    expect(() => parseGptDecision({ status: "ask" })).toThrow(/question/);
  });

  it("defaults approval_reason when missing", () => {
    const decision = parseGptDecision({
      status: "needs_approval",
      instruction: "git push origin HEAD",
    });
    expect(decision.approval_reason).toMatch(/approval/i);
  });
});
