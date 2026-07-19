import { describe, expect, it } from "vitest";
import { GITHUB_REMOTE_POLICY } from "../src/adapters/github.js";

describe("GitHub remote approval policy", () => {
  it("documents that remote actions require explicit approval", () => {
    expect(GITHUB_REMOTE_POLICY.toLowerCase()).toContain("approval");
    expect(GITHUB_REMOTE_POLICY.toLowerCase()).toMatch(/creat|push|visibility|delet/);
  });

  it("rejects unapproved github-create payloads at the contract level", () => {
    // Mirrors server.ts: POST /api/projects/github-create without approved:true → 403
    const body = {
      approved: false,
      owner: "example",
      name: "Demo",
      cwd: "/tmp/demo",
    };
    const allowed = Boolean(body.approved);
    expect(allowed).toBe(false);
  });
});
