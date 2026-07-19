import type { ApprovalPolicy } from "./config.js";
import { DEFAULT_APPROVAL } from "./config.js";
import {
  detectApprovalNeeds,
  type ApprovalCategory,
} from "./approval.js";
import {
  trustAllowsCategory,
  type TrustLevel,
} from "./trust.js";

export type PolicyRisk = "low" | "medium" | "high";

export interface ClassifiedOperation {
  command: string;
  categories: ApprovalCategory[];
  reasons: string[];
  policyKeys: string[];
  risk: PolicyRisk;
  requiresApproval: boolean;
  blockedByTrust: boolean;
  trustReason?: string;
}

/** Classify a shell command / operation for execution-time policy. */
export function classifyCommand(
  command: string,
  options: {
    policy?: ApprovalPolicy;
    trust?: TrustLevel;
  } = {},
): ClassifiedOperation {
  const policy = options.policy ?? DEFAULT_APPROVAL;
  const trust = options.trust ?? "safe_edits";
  const match = detectApprovalNeeds(command, policy);
  let blockedByTrust = false;
  let trustReason: string | undefined;
  for (const cat of match.categories) {
    const t = trustAllowsCategory(trust, cat);
    if (!t.allowed) {
      blockedByTrust = true;
      trustReason = t.reason;
      break;
    }
  }
  // Also block any write-ish command under read_only even if not in category list
  if (trust === "read_only" && looksLikeMutation(command)) {
    blockedByTrust = true;
    trustReason =
      trustReason ??
      "Project trust is Read-only — cannot run mutating commands";
  }

  const risk = riskFor(match.categories);
  return {
    command: command.trim(),
    categories: match.categories,
    reasons: match.reasons,
    policyKeys: match.categories,
    risk,
    requiresApproval: match.categories.length > 0 && !blockedByTrust,
    blockedByTrust,
    trustReason,
  };
}

function looksLikeMutation(command: string): boolean {
  return /\b(rm|mv|cp|write|install|migrate|deploy|push|commit|chmod|chown|kill|npm\s+i|pnpm\s+add|yarn\s+add)\b/i.test(
    command,
  );
}

function riskFor(categories: ApprovalCategory[]): PolicyRisk {
  if (
    categories.some((c) =>
      ["deploy", "remote_destructive", "force_git", "secrets"].includes(c),
    )
  ) {
    return "high";
  }
  if (
    categories.some((c) =>
      ["push", "database", "deletion", "dependency"].includes(c),
    )
  ) {
    return "medium";
  }
  return categories.length ? "medium" : "low";
}

export interface PolicyGateDecision {
  action: "allow" | "deny" | "approve";
  classified: ClassifiedOperation;
  message: string;
}

/**
 * Decide whether an operation may proceed. Call this before every Foundry-spawned
 * process and when agent adapters report shell tool calls.
 */
export function gateOperation(
  command: string,
  options: {
    policy?: ApprovalPolicy;
    trust?: TrustLevel;
    /** Categories already approved for this run */
    runApprovals?: Set<string>;
  } = {},
): PolicyGateDecision {
  const classified = classifyCommand(command, options);
  if (classified.blockedByTrust) {
    return {
      action: "deny",
      classified,
      message: classified.trustReason || "Blocked by project trust level",
    };
  }
  if (!classified.requiresApproval) {
    return {
      action: "allow",
      classified,
      message: "Allowed by policy",
    };
  }
  const runApprovals = options.runApprovals ?? new Set<string>();
  if (classified.categories.every((c) => runApprovals.has(c))) {
    return {
      action: "allow",
      classified,
      message: "Allowed — approved earlier this run",
    };
  }
  return {
    action: "approve",
    classified,
    message: classified.reasons.join("; ") || "Policy requires approval",
  };
}
