export type RelayStatus =
  | "idle"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "awaiting_user"
  | "completed"
  | "stopped"
  | "error";

/** GPT planner statuses. `ask` is accepted as a legacy alias for `needs_user`. */
export type GptDecisionStatus =
  | "continue"
  | "complete"
  | "needs_user"
  | "ask"
  | "needs_approval";

export type LogSource =
  | "system"
  | "gpt"
  | "cursor"
  | "user"
  | "approval"
  | "git"
  | "cost";

export interface LogEntry {
  id: string;
  ts: string;
  source: LogSource;
  round?: number;
  text: string;
}

export interface GptDecision {
  status: Exclude<GptDecisionStatus, "ask"> | "needs_user";
  /** Instruction to send to Cursor Agent CLI when status is continue / needs_approval */
  instruction?: string;
  /** Question for the human when status is needs_user */
  question?: string;
  /** Why approval is required when status is needs_approval */
  approval_reason?: string;
  /** Final summary when status is complete */
  summary?: string;
  /** Optional notes for the log */
  notes?: string;
  /** Follow-up improvements suggested after complete */
  next_improvements?: string[];
}

export interface ApprovalRequest {
  id: string;
  round: number;
  reason: string;
  instruction: string;
  categories: string[];
}

export interface RelayConfig {
  projectPath: string;
  task: string;
  maxRounds: number;
  openaiApiKey: string;
  openaiModel: string;
  cursorAgentBin: string;
  cursorApiKey?: string;
  /** Optional known project roots for auto-detect (name → path) */
  knownProjects?: Record<string, string>;
}

export interface ChangedFile {
  path: string;
  status: string;
  /** + added, - removed, ~ modified, ? untracked */
  kind: "added" | "removed" | "modified" | "untracked" | "renamed" | "other";
}

export interface DiffLine {
  type: "add" | "del" | "ctx" | "meta" | "hunk";
  text: string;
}

export interface DiffFile {
  path: string;
  status: string;
  kind: ChangedFile["kind"];
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export interface GitSnapshot {
  statusText: string;
  diffStat: string;
  diffPatch: string;
  files: ChangedFile[];
  diffFiles: DiffFile[];
  additions: number;
  deletions: number;
  /** Stable hash of the patch for loop detection */
  diffHash: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CostBreakdown {
  gptUsd: number;
  cursorTokens: number;
  gptPromptTokens: number;
  gptCompletionTokens: number;
  rounds: Array<{
    round: number;
    gptUsd: number;
    gptTokens: number;
    cursorTokens: number;
  }>;
  totalUsd: number;
}

export interface LiveStreams {
  gpt: string;
  cursor: string;
  cursorActivity: string;
}

export interface RoundRecord {
  round: number;
  instruction?: string;
  cursorOk?: boolean;
  cursorSummary?: string;
  testSummary?: string;
  decisionNotes?: string;
  stopReason?: string;
  git?: {
    filesChanged: number;
    additions: number;
    deletions: number;
    diffHash: string;
  };
}

export interface SessionMemory {
  task: string;
  projectPath: string;
  projectName: string;
  startedAt: string;
  rounds: RoundRecord[];
  filesChanged: ChangedFile[];
  testHistory: string[];
  decisions: string[];
  cursorChatId: string | null;
}

export interface DetectedProject {
  name: string;
  path: string;
  confidence: number;
  reason: string;
}

export interface RelaySnapshot {
  status: RelayStatus;
  round: number;
  maxRounds: number;
  projectPath: string;
  projectName: string;
  task: string;
  logs: LogEntry[];
  pendingApproval: ApprovalRequest | null;
  pendingQuestion: string | null;
  summary: string | null;
  nextImprovements: string[];
  changedFiles: ChangedFile[];
  git: GitSnapshot | null;
  cost: CostBreakdown;
  live: LiveStreams;
  memory: SessionMemory;
  stopReason: string | null;
  error: string | null;
}

export interface CursorRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  chatId?: string;
  /** Rough token estimate from streamed content */
  estimatedTokens: number;
  crashed: boolean;
  attempt: number;
}

export interface GptPlanResult {
  decision: GptDecision;
  usage: TokenUsage;
  estimatedUsd: number;
  rawContent: string;
}
