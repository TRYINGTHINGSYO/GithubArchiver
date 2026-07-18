import { describe, expect, it } from "vitest";
import { detectApprovalNeeds, requiresApproval } from "../src/approval.js";

describe("detectApprovalNeeds", () => {
  it("flags git push", () => {
    const match = detectApprovalNeeds("Please git push origin main");
    expect(match.categories).toContain("push");
    expect(requiresApproval("Please git push origin main")).toBe(true);
  });

  it("flags deploy commands", () => {
    const match = detectApprovalNeeds("Run railway up after the fix");
    expect(match.categories).toContain("deploy");
  });

  it("flags deletions", () => {
    const match = detectApprovalNeeds("Delete the file src/old.ts and remove directory tmp/");
    expect(match.categories).toContain("deletion");
  });

  it("flags secret changes", () => {
    const match = detectApprovalNeeds("Update OPENAI_API_KEY in .env");
    expect(match.categories).toContain("secrets");
  });

  it("allows ordinary coding work", () => {
    const text =
      "Fix the cluster title href so homepage cards open /?cluster= and add a regression test.";
    expect(requiresApproval(text)).toBe(false);
    expect(detectApprovalNeeds(text).categories).toEqual([]);
  });
});
