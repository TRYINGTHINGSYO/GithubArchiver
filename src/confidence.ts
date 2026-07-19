import type { GitSnapshot, VerifyResult } from "./types.js";

export interface ConfidenceEvidence {
  label: string;
  ok: boolean;
  note?: string;
}

export interface ConfidenceReport {
  score: number;
  evidence: ConfidenceEvidence[];
  summary: string;
}

/** Heuristic completion confidence from verification + git evidence. */
export function scoreCompletion(input: {
  verification: VerifyResult | null;
  git: GitSnapshot | null;
  summary?: string | null;
  browserVerifyRequested?: boolean;
}): ConfidenceReport {
  const evidence: ConfidenceEvidence[] = [];
  let points = 40; // base for having a completion decision

  if (input.verification) {
    for (const step of input.verification.commands) {
      evidence.push({
        label: step.name,
        ok: step.ok,
        note: step.ok ? undefined : (step.output || "").slice(0, 120),
      });
      if (step.ok) points += 12;
      else points -= 15;
    }
    if (input.verification.browser?.attempted) {
      evidence.push({
        label: "Browser smoke",
        ok: input.verification.browser.ok,
        note: input.verification.browser.report.slice(0, 120),
      });
      if (input.verification.browser.ok) points += 8;
      else points -= 8;
    }
    if (input.verification.ok) points += 10;
  } else {
    evidence.push({
      label: "Automatic verification",
      ok: false,
      note: "Not run",
    });
    points -= 10;
  }

  const files = input.git?.files?.length ?? 0;
  if (files > 0) {
    evidence.push({
      label: "Diff reviewed",
      ok: true,
      note: `${files} file(s) changed`,
    });
    points += 8;
  } else {
    evidence.push({
      label: "Workspace changes",
      ok: true,
      note: "No file changes (may be analysis-only)",
    });
  }

  if (input.browserVerifyRequested && !input.verification?.browser?.attempted) {
    evidence.push({
      label: "Browser smoke",
      ok: false,
      note: "Requested but not evidenced",
    });
    points -= 5;
  }
  if (!input.browserVerifyRequested) {
    evidence.push({
      label: "Mobile viewport test",
      ok: false,
      note: "Not run",
    });
  }

  const score = Math.max(0, Math.min(99, Math.round(points)));
  return {
    score,
    evidence,
    summary:
      score >= 80
        ? "High confidence — verification evidence looks solid"
        : score >= 55
          ? "Moderate confidence — review remaining gaps"
          : "Low confidence — treat as incomplete until verified",
  };
}
