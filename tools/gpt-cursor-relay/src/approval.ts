export type ApprovalCategory =
  | "push"
  | "deploy"
  | "deletion"
  | "secrets"
  | "force_git"
  | "remote_destructive";

export interface ApprovalMatch {
  categories: ApprovalCategory[];
  reasons: string[];
}

interface Rule {
  category: ApprovalCategory;
  pattern: RegExp;
  reason: string;
}

const RULES: Rule[] = [
  {
    category: "push",
    pattern: /\bgit\s+push\b/i,
    reason: "Instruction includes git push",
  },
  {
    category: "push",
    pattern: /\b(push\s+to\s+(origin|remote)|push\s+the\s+branch|force[-\s]?push)\b/i,
    reason: "Instruction asks to push a branch",
  },
  {
    category: "deploy",
    pattern:
      /\b(railway\s+up|railway\s+deploy|vercel\s+deploy|netlify\s+deploy|fly\s+deploy|kubectl\s+apply|helm\s+upgrade|terraform\s+apply|npm\s+run\s+deploy|wrangler\s+deploy)\b/i,
    reason: "Instruction includes a deploy command",
  },
  {
    category: "deploy",
    pattern: /\b(deploy(?:ment)?|production\s+release)\b/i,
    reason: "Instruction mentions deployment",
  },
  {
    category: "deletion",
    pattern: /\b(rm\s+-rf|git\s+clean\s+-fd|unlink\s+|delete\s+file|remove\s+directory|drop\s+table|TRUNCATE\b)\b/i,
    reason: "Instruction includes destructive deletion",
  },
  {
    category: "deletion",
    pattern: /\b(delete|remove|wipe|purge)\b.{0,40}\b(file|folder|directory|branch|database|table|secret|key)\b/i,
    reason: "Instruction asks to delete protected resources",
  },
  {
    category: "secrets",
    pattern:
      /\b(OPENAI_API_KEY|CURSOR_API_KEY|GITHUB_TOKEN|AWS_SECRET|API[_-]?KEY|PRIVATE[_-]?KEY|PASSWORD|SECRET[_-]?KEY|\.env\b)\b/i,
    reason: "Instruction references secrets or credential files",
  },
  {
    category: "secrets",
    pattern: /\b(rotate|rewrite|update|change|set)\b.{0,40}\b(secret|token|password|credential|api key)\b/i,
    reason: "Instruction asks to change secrets",
  },
  {
    category: "force_git",
    pattern: /\bgit\s+push\s+.*--force\b|\bgit\s+reset\s+--hard\b|\bgit\s+checkout\s+--\s+\.|git\s+branch\s+-D\b/i,
    reason: "Instruction includes force/hard git mutation",
  },
  {
    category: "remote_destructive",
    pattern: /\bgh\s+repo\s+delete\b|\bgit\s+push\s+.*--delete\b|\bdrop\s+database\b/i,
    reason: "Instruction includes remote-destructive operations",
  },
];

/** Scan text for actions that require human approval before running Cursor. */
export function detectApprovalNeeds(text: string): ApprovalMatch {
  const categories = new Set<ApprovalCategory>();
  const reasons: string[] = [];

  for (const rule of RULES) {
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

export function requiresApproval(text: string): boolean {
  return detectApprovalNeeds(text).categories.length > 0;
}
