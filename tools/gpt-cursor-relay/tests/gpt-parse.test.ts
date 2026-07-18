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

  it("requires summary on complete and defaults next_improvements", () => {
    expect(() => parseGptDecision({ status: "complete" })).toThrow(/summary/);
    const decision = parseGptDecision({
      status: "complete",
      summary: "Done",
      next_improvements: ["Add coverage for edge case"],
    });
    expect(decision.next_improvements).toEqual(["Add coverage for edge case"]);
  });

  it("maps ask → needs_user", () => {
    const decision = parseGptDecision({
      status: "ask",
      question: "Which branch?",
    });
    expect(decision.status).toBe("needs_user");
  });

  it("requires question on needs_user", () => {
    expect(() => parseGptDecision({ status: "needs_user" })).toThrow(/question/);
  });

  it("defaults approval_reason when missing", () => {
    const decision = parseGptDecision({
      status: "needs_approval",
      instruction: "git push origin HEAD",
    });
    expect(decision.approval_reason).toMatch(/approval/i);
  });
});
