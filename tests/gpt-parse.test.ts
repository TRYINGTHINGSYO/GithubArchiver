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

  it("parses plan", () => {
    const decision = parseGptDecision({
      status: "plan",
      plan: {
        title: "Build auth",
        steps: [
          { id: "1", title: "API", detail: "JWT endpoints", role: "backend" },
          { id: "2", title: "UI", detail: "Login page", role: "frontend" },
        ],
        estimatedMinutes: 15,
        filesLikelyTouched: ["src/auth.ts"],
        risk: "medium",
      },
    });
    expect(decision.status).toBe("plan");
    expect(decision.plan?.steps).toHaveLength(2);
  });

  it("parses parallel workers", () => {
    const decision = parseGptDecision({
      status: "parallel",
      workers: [
        {
          id: "w1",
          role: "backend",
          instruction: "Build API",
          focus: ["src/lib"],
        },
        {
          id: "w2",
          role: "frontend",
          instruction: "Build UI",
        },
      ],
      merge_instruction: "Integrate both",
    });
    expect(decision.workers).toHaveLength(2);
    expect(decision.merge_instruction).toMatch(/Integrate/);
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
});
