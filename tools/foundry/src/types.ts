export type RelayStatus =
  | "idle"
  | "planning"
  | "awaiting_plan"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "awaiting_user"
  | "verifying"
  | "supervising"
  | "completed"
  | "stopped"
  | "error";

/** GPT planner statuses. `ask` is accepted as a legacy alias for `needs_user`. */
export type GptDecisionStatus =
  | "plan"
  | "continue"
  | "parallel"
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
  | "cost"
  | "verify"
  | "supervisor"
  | "worker"
  | "style";

export interface LogEntry {
  id: string;
  ts: string;
  source: LogSource;
  round?: number;
  text: string;
}

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  role?: string;
  dependsOn?: string[];
  agentHint?: string;
}

export interface ExecutionPlan {
  title: string;
  steps: PlanStep[];
  estimatedMinutes: number;
  filesLikelyTouched: string[];
  risk: "low" | "medium" | "high";
  notes?: string;
}

export interface WorkerSpec {
  id: string;
  role: string;
  instruction: string;
  /** Optional path globs / focus areas */
  focus?: string[];
}

export interface WorkerResult {
  id: string;
  role: string;
  ok: boolean;
  summary: string;
  diffStat: string;
  filesChanged: string[];
  stdout: string;
  worktreePath?: string;
}

export interface GptDecision {
  status: Exclude<GptDecisionStatus, "ask"> | "needs_user";
  instruction?: string;
  question?: string;
  approval_reason?: string;
  summary?: string;
  notes?: string;
  next_improvements?: string[];
  plan?: ExecutionPlan;
  workers?: WorkerSpec[];
  /** Merge instruction after parallel workers finish */
  merge_instruction?: string;
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
  knownProjects?: Record<string, string>;
  /** Require plan approval before Cursor edits (default from project config / true) */
  requirePlanApproval?: boolean;
  /** Enable supervisor interventions during Cursor runs */
  supervisorEnabled?: boolean;
  /** Run automatic verification after Cursor turns */
  autoVerify?: boolean;
  /** Attempt browser verification for web apps */
  browserVerify?: boolean;
}

export interface ChangedFile {
  path: string;
  status: string;
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
  diffHash: string;
}

export interface GitIntelligence {
  theme: string;
  bullets: string[];
  risk: "low" | "medium" | "high";
  breakingChanges: string;
  migration: string;
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
  workers: Record<string, string>;
}

export interface VerifyResult {
  ok: boolean;
  commands: Array<{
    name: string;
    command: string;
    ok: boolean;
    exitCode: number | null;
    output: string;
    durationMs: number;
  }>;
  summary: string;
  coverageNote?: string;
  browser?: {
    attempted: boolean;
    ok: boolean;
    report: string;
  };
}

export interface SupervisorEvent {
  ts: string;
  activity: string;
  decision: "allow" | "redirect" | "stop";
  reason: string;
  redirectInstruction?: string;
}

export interface RoundRecord {
  round: number;
  instruction?: string;
  cursorOk?: boolean;
  cursorSummary?: string;
  testSummary?: string;
  decisionNotes?: string;
  stopReason?: string;
  verifySummary?: string;
  git?: {
    filesChanged: number;
    additions: number;
    deletions: number;
    diffHash: string;
  };
}

export interface CodingStylePrefs {
  prefers: string[];
  avoids: string[];
  notes: string[];
  updatedAt: string;
}

export interface ProjectLongMemory {
  projectPath: string;
  projectName: string;
  sessions: Array<{
    id: string;
    task: string;
    startedAt: string;
    summary?: string;
    decisions: string[];
  }>;
  style: CodingStylePrefs;
  facts: string[];
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
  style: CodingStylePrefs;
  longMemoryFacts: string[];
}

export interface RollbackCheckpoint {
  id: string;
  createdAt: string;
  projectPath: string;
  headSha: string;
  stashRef: string | null;
  label: string;
}

export interface DetectedProject {
  name: string;
  path: string;
  confidence: number;
  reason: string;
}

export interface TimelineEventView {
  id: string;
  ts: string;
  type: string;
  message: string;
  round?: number;
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
  pendingPlan: ExecutionPlan | null;
  summary: string | null;
  nextImprovements: string[];
  changedFiles: ChangedFile[];
  git: GitSnapshot | null;
  gitIntel: GitIntelligence | null;
  verification: VerifyResult | null;
  workers: WorkerResult[];
  supervisorLog: SupervisorEvent[];
  cost: CostBreakdown;
  live: LiveStreams;
  memory: SessionMemory;
  checkpoint: RollbackCheckpoint | null;
  canRollback: boolean;
  stopReason: string | null;
  error: string | null;
  flags: {
    requirePlanApproval: boolean;
    supervisorEnabled: boolean;
    autoVerify: boolean;
    browserVerify: boolean;
  };
  /** Structured execution timeline */
  timeline: TimelineEventView[];
  /** Active plugin ids */
  plugins: string[];
  /** Config source path if loaded */
  configSource: string | null;
  /** Opaque session id for crash recovery */
  sessionId: string | null;
  agentId: string;
  /** Task dependency graph (when planning produced one) */
  taskGraph: {
    id: string;
    title: string;
    nodes: Array<{
      id: string;
      title: string;
      detail: string;
      role?: string;
      dependsOn: string[];
      status: string;
      attempts: number;
      error?: string;
    }>;
    progress: {
      total: number;
      passed: number;
      failed: number;
      running: number;
      ready: number;
      blocked: number;
      complete: boolean;
    };
  } | null;
  productName: string;
}

export interface CursorRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  chatId?: string;
  estimatedTokens: number;
  crashed: boolean;
  attempt: number;
  abortedBySupervisor?: boolean;
}

export interface GptPlanResult {
  decision: GptDecision;
  usage: TokenUsage;
  estimatedUsd: number;
  rawContent: string;
}

export interface SuperviseDecision {
  decision: "allow" | "redirect" | "stop";
  reason: string;
  redirectInstruction?: string;
}
