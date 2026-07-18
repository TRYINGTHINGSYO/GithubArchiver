import type { GptClient } from "./gpt.js";
import type { SuperviseDecision } from "./types.js";

const SENSITIVE_PATH =
  /\b(auth|session|token|middleware|migration|\.env|password|secret)\b/i;

export function shouldSuperviseActivity(activity: string): boolean {
  if (/^Editing\s+/i.test(activity)) return true;
  if (/^Running\s+/i.test(activity) && /\b(rm|git\s+push|deploy|migrate)\b/i.test(activity)) {
    return true;
  }
  if (SENSITIVE_PATH.test(activity)) return true;
  return false;
}

export async function superviseActivity(
  gpt: GptClient,
  input: {
    task: string;
    activity: string;
    currentInstruction: string;
    styleNotes?: string;
  },
): Promise<SuperviseDecision> {
  // Fast local short-circuit for clearly safe reads
  if (/^Reading\s+/i.test(input.activity)) {
    return { decision: "allow", reason: "Read-only activity" };
  }

  return gpt.supervise({
    task: input.task,
    activity: input.activity,
    currentInstruction: input.currentInstruction,
    styleNotes: input.styleNotes,
  });
}
