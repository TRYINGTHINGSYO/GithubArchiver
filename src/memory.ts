import path from "node:path";
import { defaultStyle } from "./persist.js";
import type {
  ChangedFile,
  CodingStylePrefs,
  RoundRecord,
  SessionMemory,
} from "./types.js";

export function createSessionMemory(
  task: string,
  projectPath: string,
  extras?: {
    style?: CodingStylePrefs;
    longMemoryFacts?: string[];
  },
): SessionMemory {
  return {
    task,
    projectPath,
    projectName: path.basename(projectPath) || projectPath,
    startedAt: new Date().toISOString(),
    rounds: [],
    filesChanged: [],
    testHistory: [],
    decisions: [],
    cursorChatId: null,
    style: extras?.style ?? defaultStyle(),
    longMemoryFacts: extras?.longMemoryFacts ?? [],
  };
}

export function upsertRound(memory: SessionMemory, record: RoundRecord): void {
  const idx = memory.rounds.findIndex((r) => r.round === record.round);
  if (idx >= 0) {
    memory.rounds[idx] = { ...memory.rounds[idx], ...record };
  } else {
    memory.rounds.push(record);
  }
}

export function mergeChangedFiles(
  memory: SessionMemory,
  files: ChangedFile[],
): void {
  const map = new Map(memory.filesChanged.map((f) => [f.path, f]));
  for (const file of files) {
    map.set(file.path, file);
  }
  memory.filesChanged = [...map.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
}

export function rememberDecision(memory: SessionMemory, decision: string): void {
  const text = decision.trim();
  if (!text) return;
  if (!memory.decisions.includes(text)) {
    memory.decisions.push(text);
  }
  if (memory.decisions.length > 40) {
    memory.decisions = memory.decisions.slice(-40);
  }
}

export function rememberTestResult(
  memory: SessionMemory,
  summary: string,
): void {
  const text = summary.trim();
  if (!text) return;
  memory.testHistory.push(text);
  if (memory.testHistory.length > 30) {
    memory.testHistory = memory.testHistory.slice(-30);
  }
}

export function extractTestSummary(text: string): string | null {
  const patterns = [
    /(\d+)\s+passed(?:\s*,\s*(\d+)\s+failed)?/i,
    /Tests?\s*[:=]\s*(\d+)\s+passed/i,
    /FAIL(?:ED)?\s+(\S+)/i,
    /(\d+)\s+failed/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export function formatMemoryForPrompt(memory: SessionMemory): string {
  const recentRounds = memory.rounds.slice(-8).map((r) => {
    const bits = [`round ${r.round}`];
    if (r.instruction) bits.push(`instruction: ${r.instruction.slice(0, 240)}`);
    if (r.cursorSummary) bits.push(`cursor: ${r.cursorSummary.slice(0, 240)}`);
    if (r.testSummary) bits.push(`tests: ${r.testSummary}`);
    if (r.verifySummary) bits.push(`verify: ${r.verifySummary.slice(0, 160)}`);
    if (r.git) {
      bits.push(
        `git: ${r.git.filesChanged} files +${r.git.additions}/-${r.git.deletions}`,
      );
    }
    if (r.stopReason) bits.push(`stop: ${r.stopReason}`);
    return `- ${bits.join(" | ")}`;
  });

  return [
    `Original task: ${memory.task}`,
    `Project: ${memory.projectName} (${memory.projectPath})`,
    `Cursor chat id: ${memory.cursorChatId ?? "(new)"}`,
    "",
    "Round history:",
    recentRounds.length ? recentRounds.join("\n") : "- (none yet)",
    "",
    "Files changed (session):",
    memory.filesChanged.length
      ? memory.filesChanged.map((f) => `- ${f.kind} ${f.path}`).join("\n")
      : "- (none)",
    "",
    "Test history:",
    memory.testHistory.length
      ? memory.testHistory.map((t) => `- ${t}`).join("\n")
      : "- (none)",
    "",
    "Decisions:",
    memory.decisions.length
      ? memory.decisions.map((d) => `- ${d}`).join("\n")
      : "- (none)",
    "",
    "Coding style:",
    memory.style.prefers.length
      ? memory.style.prefers.map((p) => `✓ ${p}`).join("\n")
      : "✓ (none yet)",
    memory.style.avoids.length
      ? memory.style.avoids.map((a) => `✗ avoid ${a}`).join("\n")
      : "",
    "",
    "Long-term facts:",
    memory.longMemoryFacts.length
      ? memory.longMemoryFacts.slice(-10).map((f) => `- ${f}`).join("\n")
      : "- (none)",
  ].join("\n");
}
