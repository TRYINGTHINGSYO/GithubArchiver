import { describe, expect, it } from "vitest";
import { classifyCommand, gateOperation } from "../src/policy.js";
import { DEFAULT_APPROVAL } from "../src/config.js";

describe("execution policy", () => {
  it("classifies deploy commands as high risk needing approval", () => {
    const c = classifyCommand("npm run deploy", {
      policy: DEFAULT_APPROVAL,
      trust: "full_automation",
    });
    expect(c.categories).toContain("deploy");
    expect(c.risk).toBe("high");
    expect(c.requiresApproval).toBe(true);
  });

  it("blocks push under safe_edits trust", () => {
    const g = gateOperation("git push origin main", {
      trust: "safe_edits",
      policy: DEFAULT_APPROVAL,
    });
    expect(g.action).toBe("deny");
    expect(g.classified.blockedByTrust).toBe(true);
  });

  it("allows already run-approved categories", () => {
    const g = gateOperation("npm install lodash", {
      trust: "safe_edits",
      policy: { ...DEFAULT_APPROVAL, before_dependency_updates: true },
      runApprovals: new Set(["dependency"]),
    });
    expect(g.action).toBe("allow");
  });

  it("allows ordinary test commands", () => {
    const g = gateOperation("npm test", {
      trust: "safe_edits",
      policy: DEFAULT_APPROVAL,
    });
    expect(g.action).toBe("allow");
  });

  it("blocks mutations under read_only", () => {
    const g = gateOperation("rm -rf src/tmp", {
      trust: "read_only",
      policy: DEFAULT_APPROVAL,
    });
    expect(g.action).toBe("deny");
  });
});
