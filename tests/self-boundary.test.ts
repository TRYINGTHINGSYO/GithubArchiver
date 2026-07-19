import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectApprovalNeeds } from "../src/approval.js";
import {
  applySelfBoundary,
  isFoundrySelfProject,
  FOUNDRY_SELF_APPROVAL,
} from "../src/self-boundary.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("Foundry self-project boundary", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("detects a Foundry-shaped package", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "foundry-self-"));
    dirs.push(root);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "foundry",
        bin: { foundry: "./bin/foundry.js" },
      }),
      "utf8",
    );
    await mkdir(path.join(root, "bin"), { recursive: true });
    await writeFile(path.join(root, "bin", "foundry.js"), "#!/usr/bin/env node\n", "utf8");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "relay.ts"), "export {}\n", "utf8");

    expect(await isFoundrySelfProject(root)).toBe(true);
  });

  it("does not treat ordinary apps as Foundry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "foundry-other-"));
    dirs.push(root);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "inventory" }),
      "utf8",
    );
    expect(await isFoundrySelfProject(root)).toBe(false);
  });

  it("forces plan/push/dependency/self-update/deploy approvals", () => {
    const loose = applySelfBoundary({
      ...DEFAULT_CONFIG,
      require_plan_approval: false,
      trust: "full_automation",
      approval: {
        ...DEFAULT_CONFIG.approval,
        before_commits: false,
        before_pushes: false,
        before_dependency_updates: false,
        before_deploys: false,
        before_self_updates: false,
      },
    });
    expect(loose.require_plan_approval).toBe(true);
    expect(loose.trust).toBe("safe_edits");
    expect(loose.approval).toEqual(FOUNDRY_SELF_APPROVAL);
    expect(loose.approval.before_pushes).toBe(true);
    expect(loose.approval.before_dependency_updates).toBe(true);
    expect(loose.approval.before_self_updates).toBe(true);
    expect(loose.approval.before_deploys).toBe(true);
  });

  it("flags self-update control-plane edits", () => {
    const match = detectApprovalNeeds(
      "Edit src/policy.ts and src/approval.ts to loosen gates",
      FOUNDRY_SELF_APPROVAL,
    );
    expect(match.categories).toContain("self_update");
  });
});
