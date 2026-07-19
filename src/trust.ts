/** Project trust levels — permanently visible near the project name. */
export type TrustLevel =
  | "read_only"
  | "safe_edits"
  | "local_autonomous"
  | "full_automation";

export const TRUST_LABELS: Record<TrustLevel, string> = {
  read_only: "Read-only",
  safe_edits: "Safe edits",
  local_autonomous: "Local autonomous",
  full_automation: "Full automation",
};

export const TRUST_DESCRIPTIONS: Record<TrustLevel, string> = {
  read_only: "Can inspect and plan only — no file edits",
  safe_edits: "Can edit files and run tests",
  local_autonomous: "Can edit, test, and commit locally",
  full_automation: "Can push and deploy under defined policies",
};

export function normalizeTrustLevel(raw: unknown): TrustLevel {
  if (raw === "read-only" || raw === "read_only") return "read_only";
  if (raw === "safe-edits" || raw === "safe_edits") return "safe_edits";
  if (raw === "local-autonomous" || raw === "local_autonomous") {
    return "local_autonomous";
  }
  if (raw === "full-automation" || raw === "full_automation") {
    return "full_automation";
  }
  return "safe_edits";
}

/** Whether trust level permits a policy category without elevating to full automation. */
export function trustAllowsCategory(
  trust: TrustLevel,
  category: string,
): { allowed: boolean; reason?: string } {
  if (trust === "read_only") {
    return {
      allowed: false,
      reason: "Project trust is Read-only — cannot mutate the workspace",
    };
  }
  if (trust === "safe_edits") {
    if (
      [
        "push",
        "deploy",
        "commit",
        "remote_destructive",
        "force_git",
        "self_update",
      ].includes(category)
    ) {
      return {
        allowed: false,
        reason: `Trust Safe edits blocks ${category} (raise to Local autonomous or Full automation)`,
      };
    }
  }
  if (trust === "local_autonomous") {
    if (["push", "deploy", "remote_destructive"].includes(category)) {
      return {
        allowed: false,
        reason: `Trust Local autonomous blocks ${category} (raise to Full automation)`,
      };
    }
  }
  return { allowed: true };
}
