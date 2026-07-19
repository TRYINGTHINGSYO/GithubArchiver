import type { ApprovalPolicy } from "./config.js";
import { DEFAULT_APPROVAL } from "./config.js";

export type ApprovalCategory =
  | "push"
  | "deploy"
  | "deletion"
  | "secrets"
  | "force_git"
  | "remote_destructive"
  | "database"
  | "dependency"
  | "commit"
  | "self_update";

export interface ApprovalMatch {
  categories: ApprovalCategory[];
  reasons: string[];
}

interface Rule {
  category: ApprovalCategory;
  pattern: RegExp;
  reason: string;
  policyKey: keyof ApprovalPolicy;
}

const RULES: Rule[] = [
  {
    category: "push",
    pattern: /\bgit\s+push\b/i,
    reason: "Instruction includes git push",
    policyKey: "before_pushes",
  },
  {
    category: "push",
    pattern: /\b(push\s+to\s+(origin|remote)|push\s+the\s+branch|force[-\s]?push)\b/i,
    reason: "Instruction asks to push a branch",
    policyKey: "before_pushes",
  },
  {
    category: "deploy",
    pattern:
      /\b(railway\s+up|railway\s+deploy|vercel\s+deploy|netlify\s+deploy|fly\s+deploy|kubectl\s+apply|helm\s+upgrade|terraform\s+apply|npm\s+run\s+deploy|wrangler\s+deploy)\b/i,
    reason: "Instruction includes a deploy command",
    policyKey: "before_deploys",
  },
  {
    category: "deploy",
    pattern: /\b(deploy(?:ment)?|production\s+release)\b/i,
    reason: "Instruction mentions deployment",
    policyKey: "before_deploys",
  },
  {
    category: "deletion",
    pattern: /\b(rm\s+-rf|git\s+clean\s+-fd|unlink\s+|delete\s+file|remove\s+directory|drop\s+table|TRUNCATE\b)\b/i,
    reason: "Instruction includes destructive deletion",
    policyKey: "before_deleting_files",
  },
  {
    category: "deletion",
    pattern: /\b(delete|remove|wipe|purge)\b.{0,40}\b(file|folder|directory|branch|database|table|secret|key)\b/i,
    reason: "Instruction asks to delete protected resources",
    policyKey: "before_deleting_files",
  },
  {
    category: "secrets",
    pattern:
      /\b(OPENAI_API_KEY|CURSOR_API_KEY|GITHUB_TOKEN|AWS_SECRET|API[_-]?KEY|PRIVATE[_-]?KEY|PASSWORD|SECRET[_-]?KEY|\.env\b)\b/i,
    reason: "Instruction references secrets or credential files",
    policyKey: "before_secret_changes",
  },
  {
    category: "secrets",
    pattern: /\b(rotate|rewrite|update|change|set)\b.{0,40}\b(secret|token|password|credential|api key)\b/i,
    reason: "Instruction asks to change secrets",
    policyKey: "before_secret_changes",
  },
  {
    category: "force_git",
    pattern: /\bgit\s+push\s+.*--force\b|\bgit\s+reset\s+--hard\b|\bgit\s+checkout\s+--\s+\.|git\s+branch\s+-D\b/i,
    reason: "Instruction includes force/hard git mutation",
    policyKey: "before_pushes",
  },
  {
    category: "remote_destructive",
    pattern: /\bgh\s+repo\s+delete\b|\bgit\s+push\s+.*--delete\b|\bdrop\s+database\b/i,
    reason: "Instruction includes remote-destructive operations",
    policyKey: "before_deploys",
  },
  {
    category: "database",
    pattern:
      /\b(migration|migrate|schema\s+change|alter\s+table|drop\s+table|CREATE\s+TABLE|db:migrate|prisma\s+migrate|drizzle-kit)\b/i,
    reason: "Instruction includes database/schema changes",
    policyKey: "before_database_changes",
  },
  {
    category: "dependency",
    pattern:
      /\b(npm\s+install|npm\s+i\b|pnpm\s+add|yarn\s+add|bun\s+add|package\.json|update\s+dependencies|bump\s+dependency)\b/i,
    reason: "Instruction updates dependencies",
    policyKey: "before_dependency_updates",
  },
  {
    category: "commit",
    pattern: /\bgit\s+commit\b|\bcommit\s+the\s+changes\b|\bcreate\s+a\s+commit\b/i,
    reason: "Instruction creates a git commit",
    policyKey: "before_commits",
  },
  {
    category: "self_update",
    pattern:
      /\b(npm\s+publish|prepublishOnly|bump\s+version|release\s+foundry|self[-\s]?update|update\s+foundry\s+itself)\b/i,
    reason: "Instruction updates or publishes Foundry itself",
    policyKey: "before_self_updates",
  },
  {
    category: "self_update",
    pattern:
      /\b(src\/(relay|policy|approval|trust|self-boundary)\.ts|bin\/foundry\.js)\b/i,
    reason: "Instruction edits Foundry core control-plane files",
    policyKey: "before_self_updates",
  },
];

/** Scan text for actions that require human approval, filtered by project policy. */
export function detectApprovalNeeds(
  text: string,
  policy: ApprovalPolicy = DEFAULT_APPROVAL,
): ApprovalMatch {
  const categories = new Set<ApprovalCategory>();
  const reasons: string[] = [];

  for (const rule of RULES) {
    if (!policy[rule.policyKey]) continue;
    if (rule.pattern.test(text)) {
      categories.add(rule.category);
      if (!reasons.includes(rule.reason)) {
        reasons.push(rule.reason);
      }
    }
  }

  return {
    categories: [...categories],
    reasons,
  };
}

export function requiresApproval(
  text: string,
  policy: ApprovalPolicy = DEFAULT_APPROVAL,
): boolean {
  return detectApprovalNeeds(text, policy).categories.length > 0;
}
