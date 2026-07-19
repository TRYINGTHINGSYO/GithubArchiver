/**
 * Release boundary when Foundry opens its own repository.
 * An orchestrator editing the orchestrator that controls its permissions
 * must stay stricter than ordinary managed projects.
 */
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import type { ApprovalPolicy, ProjectRelayConfig } from "./config.js";
import { DEFAULT_APPROVAL } from "./config.js";

/** Forced approvals for Foundry-on-Foundry work. */
export const FOUNDRY_SELF_APPROVAL: ApprovalPolicy = {
  before_database_changes: true,
  before_deleting_files: true,
  before_dependency_updates: true,
  before_commits: true,
  before_pushes: true,
  before_deploys: true,
  before_secret_changes: true,
  before_self_updates: true,
};

export const FOUNDRY_SELF_BOUNDARY = {
  require_plan_approval: true,
  trust: "safe_edits" as const,
  approval: FOUNDRY_SELF_APPROVAL,
  message:
    "Self-project boundary: plan, push, dependency, self-update, and deploy approvals are required.",
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect that the open project is Foundry itself (package name + layout markers).
 */
export async function isFoundrySelfProject(
  projectPath: string,
): Promise<boolean> {
  const root = path.resolve(projectPath);
  const pkgPath = path.join(root, "package.json");
  if (!(await pathExists(pkgPath))) return false;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      name?: string;
      bin?: Record<string, string>;
    };
    if (pkg.name !== "foundry") return false;
    const hasBin =
      Boolean(pkg.bin?.foundry) ||
      (await pathExists(path.join(root, "bin", "foundry.js")));
    const hasOrchestrator =
      (await pathExists(path.join(root, "src", "relay.ts"))) ||
      (await pathExists(path.join(root, "dist", "relay.js")));
    return hasBin && hasOrchestrator;
  } catch {
    return false;
  }
}

/** Merge self-boundary over a loaded project config (never loosens approvals). */
export function applySelfBoundary(
  config: ProjectRelayConfig,
): ProjectRelayConfig {
  const approval: ApprovalPolicy = { ...DEFAULT_APPROVAL, ...config.approval };
  for (const key of Object.keys(FOUNDRY_SELF_APPROVAL) as Array<
    keyof ApprovalPolicy
  >) {
    approval[key] = true;
  }
  return {
    ...config,
    require_plan_approval: true,
    trust: "safe_edits",
    approval,
  };
}
