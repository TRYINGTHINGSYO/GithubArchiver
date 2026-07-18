export type RelayStatus =
  | "idle"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "awaiting_user"
  | "completed"
  | "stopped"
  | "error";

export type GptDecisionStatus =
  | "continue"
  | "complete"
  | "ask"
  | "needs_approval";

export type LogSource = "system" | "gpt" | "cursor" | "user" | "approval";

export interface LogEntry {
  id: string;
  ts: string;
  source: LogSource;
  round?: number;
  text: string;
}

export interface GptDecision {
  status: GptDecisionStatus;
  /** Instruction to send to Cursor Agent CLI when status is continue / needs_approval */
  instruction?: string;
  /** Question for the human when status is ask */
  question?: string;
  /** Why approval is required when status is needs_approval */
  approval_reason?: string;
  /** Final summary when status is complete */
  summary?: string;
  /** Optional notes for the log */
  notes?: string;
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
}

export interface ChangedFile {
  path: string;
  status: string;
}

export interface RelaySnapshot {
  status: RelayStatus;
  round: number;
  maxRounds: number;
  projectPath: string;
  task: string;
  logs: LogEntry[];
  pendingApproval: ApprovalRequest | null;
  pendingQuestion: string | null;
  summary: string | null;
  changedFiles: ChangedFile[];
  error: string | null;
}

export interface CursorRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}
