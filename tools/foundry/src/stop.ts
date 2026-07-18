import type { GitSnapshot, RoundRecord } from "./types.js";

export type StopReasonCode =
  | "max_rounds"
  | "duplicate_instruction"
  | "identical_diff"
  | "no_file_changes"
  | "repeated_test_failure"
  | "repeated_build_failure"
  | "gpt_complete"
  | "needs_user"
  | "approval_denied"
  | "user_stop"
  | "safety";

export interface StopCheckInput {
  round: number;
  maxRounds: number;
  instruction: string;
  previousInstructions: string[];
  git: GitSnapshot;
  previousDiffHash: string | null;
  /** True if this Cursor turn was expected to mutate the tree */
  expectChanges: boolean;
  /** Consecutive rounds with zero file changes after Cursor ran */
  noChangeStreak: number;
  testHistory: string[];
  cursorOk: boolean;
  cursorText: string;
  rounds: RoundRecord[];
}

export interface StopCheckResult {
  stop: boolean;
  code?: StopReasonCode;
  message?: string;
}

function normalizeInstruction(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function isFailureLine(text: string): boolean {
  return /\b(fail|failed|error|✖|×)\b/i.test(text) && !/\b0\s+failed\b/i.test(text);
}

function isBuildFailure(text: string): boolean {
  return /\b(build failed|typescript error|error TS\d+|vite.*failed|compilation failed)\b/i.test(
    text,
  );
}

/**
 * Heuristics that halt the autonomous loop even if GPT keeps saying continue.
 * Checked after each Cursor turn (and for max rounds before planning).
 */
export function evaluateStopConditions(input: StopCheckInput): StopCheckResult {
  if (input.round > input.maxRounds) {
    return {
      stop: true,
      code: "max_rounds",
      message: `Maximum iterations reached (${input.maxRounds}).`,
    };
  }

  const normalized = normalizeInstruction(input.instruction);
  if (
    normalized &&
    input.previousInstructions.some((prev) => normalizeInstruction(prev) === normalized)
  ) {
    return {
      stop: true,
      code: "duplicate_instruction",
      message: "Same Cursor instruction repeated — stopping to avoid a loop.",
    };
  }

  if (
    input.previousDiffHash &&
    input.git.diffHash &&
    input.git.diffHash === input.previousDiffHash &&
    input.git.files.length > 0
  ) {
    return {
      stop: true,
      code: "identical_diff",
      message: "Git diff identical to the previous round — stopping to avoid a loop.",
    };
  }

  if (input.expectChanges && input.noChangeStreak >= 2) {
    return {
      stop: true,
      code: "no_file_changes",
      message: "No files changed across consecutive Cursor turns — stopping.",
    };
  }

  const recentTests = input.testHistory.slice(-3);
  if (
    recentTests.length >= 3 &&
    recentTests.every(isFailureLine) &&
    new Set(recentTests.map((t) => t.toLowerCase())).size === 1
  ) {
    return {
      stop: true,
      code: "repeated_test_failure",
      message: "Same test failure repeated three times — stopping.",
    };
  }

  const recentCursor = input.rounds
    .slice(-3)
    .map((r) => r.cursorSummary ?? "")
    .filter(Boolean);
  const buildFails = [...recentCursor, input.cursorText].filter(isBuildFailure);
  if (buildFails.length >= 3) {
    return {
      stop: true,
      code: "repeated_build_failure",
      message: "Build keeps failing — stopping for human review.",
    };
  }

  return { stop: false };
}

export function shouldRetryCursor(result: {
  crashed: boolean;
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}): boolean {
  if (result.timedOut) return false;
  if (result.crashed) return true;
  // Unexpected exit with almost no output — treat as crash-like.
  if (!result.ok && !result.stdout && /spawn|ENOENT|signal|EPIPE/i.test(result.stderr)) {
    return true;
  }
  if (!result.ok && result.exitCode != null && result.exitCode < 0) {
    return true;
  }
  return false;
}
