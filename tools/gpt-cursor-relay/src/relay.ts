import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { detectApprovalNeeds } from "./approval.js";
import { addRoundCost, emptyCost, formatCostSummary } from "./cost.js";
import { CursorRunner } from "./cursor.js";
import {
  collectGitSnapshot,
  formatGitForPrompt,
  listChangedFiles,
} from "./git.js";
import { GptClient } from "./gpt.js";
import {
  createSessionMemory,
  extractTestSummary,
  mergeChangedFiles,
  rememberDecision,
  rememberTestResult,
  upsertRound,
} from "./memory.js";
import { evaluateStopConditions, shouldRetryCursor } from "./stop.js";
import type {
  ApprovalRequest,
  CostBreakdown,
  GitSnapshot,
  LiveStreams,
  LogEntry,
  RelayConfig,
  RelaySnapshot,
  RelayStatus,
  SessionMemory,
} from "./types.js";

type Listener = (snapshot: RelaySnapshot) => void;

const MAX_CURSOR_ATTEMPTS = 3;

export interface RelayDependencies {
  gpt: GptClient;
  cursor: CursorRunner;
  collectGitSnapshot?: typeof collectGitSnapshot;
  listChangedFiles?: typeof listChangedFiles;
}

export class RelaySession {
  private status: RelayStatus = "idle";
  private round = 0;
  private maxRounds = 8;
  private projectPath = "";
  private projectName = "";
  private task = "";
  private logs: LogEntry[] = [];
  private pendingApproval: ApprovalRequest | null = null;
  private pendingQuestion: string | null = null;
  private summary: string | null = null;
  private nextImprovements: string[] = [];
  private git: GitSnapshot | null = null;
  private cost: CostBreakdown = emptyCost();
  private live: LiveStreams = { gpt: "", cursor: "", cursorActivity: "" };
  private memory: SessionMemory = createSessionMemory("", "");
  private stopReason: string | null = null;
  private error: string | null = null;
  private listeners = new Set<Listener>();
  private abortController: AbortController | null = null;
  private pauseRequested = false;
  private pauseWaiters: Array<() => void> = [];
  private approvalWaiter: { resolve: (approved: boolean) => void } | null = null;
  private userWaiter: { resolve: (reply: string) => void } | null = null;
  private loopPromise: Promise<void> | null = null;
  private readonly gpt: GptClient;
  private readonly cursor: CursorRunner;
  private readonly collectGitSnapshotFn: typeof collectGitSnapshot;
  private readonly listChangedFilesFn: typeof listChangedFiles;

  constructor(deps: RelayDependencies) {
    this.gpt = deps.gpt;
    this.cursor = deps.cursor;
    this.collectGitSnapshotFn = deps.collectGitSnapshot ?? collectGitSnapshot;
    this.listChangedFilesFn = deps.listChangedFiles ?? listChangedFiles;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): RelaySnapshot {
    return {
      status: this.status,
      round: this.round,
      maxRounds: this.maxRounds,
      projectPath: this.projectPath,
      projectName: this.projectName,
      task: this.task,
      logs: [...this.logs],
      pendingApproval: this.pendingApproval,
      pendingQuestion: this.pendingQuestion,
      summary: this.summary,
      nextImprovements: [...this.nextImprovements],
      changedFiles: [...(this.git?.files ?? this.memory.filesChanged)],
      git: this.git,
      cost: this.cost,
      live: { ...this.live },
      memory: {
        ...this.memory,
        rounds: [...this.memory.rounds],
        filesChanged: [...this.memory.filesChanged],
        testHistory: [...this.memory.testHistory],
        decisions: [...this.memory.decisions],
      },
      stopReason: this.stopReason,
      error: this.error,
    };
  }

  async start(config: RelayConfig): Promise<void> {
    if (this.loopPromise) {
      throw new Error("Relay already active");
    }
    if (!config.task.trim()) {
      throw new Error("Task is required");
    }
    if (!config.projectPath.trim()) {
      throw new Error("Project folder is required");
    }
    await access(config.projectPath, fsConstants.R_OK);

    this.projectPath = config.projectPath;
    this.projectName = path.basename(config.projectPath) || config.projectPath;
    this.task = config.task.trim();
    this.maxRounds = Math.max(1, Math.min(50, config.maxRounds || 8));
    this.round = 0;
    this.logs = [];
    this.pendingApproval = null;
    this.pendingQuestion = null;
    this.summary = null;
    this.nextImprovements = [];
    this.git = null;
    this.cost = emptyCost();
    this.live = { gpt: "", cursor: "", cursorActivity: "" };
    this.memory = createSessionMemory(this.task, this.projectPath);
    this.stopReason = null;
    this.error = null;
    this.pauseRequested = false;
    this.status = "running";
    this.abortController = new AbortController();
    this.gpt.resetConversation();

    this.log("system", `Autonomous relay started · ${this.projectName}`);
    this.log("system", `Task: ${this.task}`);
    this.log("system", `Max rounds: ${this.maxRounds} · auto-continues until complete / needs_user / safety stop`);
    this.emit();

    this.loopPromise = this.runLoop().finally(() => {
      this.loopPromise = null;
      this.abortController = null;
    });
    await this.loopPromise;
  }

  pause(): void {
    if (this.status !== "running") return;
    this.pauseRequested = true;
    this.status = "paused";
    this.log("system", "Pause requested — will pause after the current step");
    this.emit();
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.pauseRequested = false;
    this.status = "running";
    this.log("system", "Resumed");
    this.emit();
    for (const wake of this.pauseWaiters.splice(0)) wake();
  }

  async stop(): Promise<void> {
    if (!this.loopPromise && this.status === "idle") return;
    this.log("system", "Stop requested");
    this.status = "stopped";
    this.stopReason = "user_stop";
    this.pauseRequested = false;
    for (const wake of this.pauseWaiters.splice(0)) wake();
    if (this.approvalWaiter) {
      this.approvalWaiter.resolve(false);
      this.approvalWaiter = null;
    }
    if (this.userWaiter) {
      this.userWaiter.resolve("");
      this.userWaiter = null;
    }
    this.abortController?.abort();
    this.emit();
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
    }
  }

  resolveApproval(approved: boolean): void {
    if (!this.approvalWaiter || !this.pendingApproval) {
      throw new Error("No pending approval");
    }
    const instruction = this.pendingApproval.instruction;
    this.log(
      "approval",
      approved
        ? `Approved: ${this.pendingApproval.reason}`
        : `Denied: ${this.pendingApproval.reason}`,
    );
    if (approved) {
      this.log("user", `Proceed with Cursor instruction:\n${instruction}`);
    }
    this.pendingApproval = null;
    this.status = approved ? "running" : "stopped";
    if (!approved) this.stopReason = "approval_denied";
    const waiter = this.approvalWaiter;
    this.approvalWaiter = null;
    this.emit();
    waiter.resolve(approved);
  }

  answerQuestion(reply: string): void {
    if (!this.userWaiter || !this.pendingQuestion) {
      throw new Error("No pending question");
    }
    const text = reply.trim();
    if (!text) {
      throw new Error("Reply is required");
    }
    this.log("user", text);
    rememberDecision(this.memory, `User answered: ${text.slice(0, 200)}`);
    this.pendingQuestion = null;
    this.status = "running";
    const waiter = this.userWaiter;
    this.userWaiter = null;
    this.emit();
    waiter.resolve(text);
  }

  /** Continue after complete by turning next_improvements into a new task. */
  async continueWithImprovements(): Promise<void> {
    if (this.status !== "completed" || !this.nextImprovements.length) {
      throw new Error("No next improvements to continue with");
    }
    const followUp = this.nextImprovements.map((i, n) => `${n + 1}. ${i}`).join("\n");
    const prior = this.task;
    await this.start({
      projectPath: this.projectPath,
      task: `Continue from prior completed task (${prior}). Implement these next improvements:\n${followUp}`,
      maxRounds: this.maxRounds,
      openaiApiKey: "",
      openaiModel: "",
      cursorAgentBin: "",
    });
  }

  private isStopRequested(): boolean {
    return this.status === "stopped";
  }

  private isLoopOpen(): boolean {
    return this.status === "running" || this.status === "paused";
  }

  private async runLoop(): Promise<void> {
    let lastCursorResult: string | undefined;
    let userReply: string | undefined;
    let previousDiffHash: string | null = null;
    let noChangeStreak = 0;
    const previousInstructions: string[] = [];

    try {
      // Baseline git before first plan
      this.git = await this.collectGitSnapshotFn(this.projectPath);
      this.emit();

      while (this.isLoopOpen()) {
        await this.waitIfPaused();
        if (this.isStopRequested()) break;

        this.round += 1;
        if (this.round > this.maxRounds) {
          this.finishAsStopped(
            "max_rounds",
            `Stopped after max rounds (${this.maxRounds}).`,
          );
          break;
        }

        this.live = { gpt: "", cursor: "", cursorActivity: "Waiting for GPT…" };
        this.log("system", `Round ${this.round}: GPT planning (streaming)`);
        this.emit();

        // Refresh git before GPT so it reviews actual code changes.
        this.git = await this.collectGitSnapshotFn(this.projectPath);
        const gitContext = formatGitForPrompt(this.git);
        this.log(
          "git",
          `${this.git.files.length} files · +${this.git.additions}/-${this.git.deletions}` +
            (this.git.diffStat ? `\n${this.git.diffStat}` : ""),
          this.round,
        );
        this.emit();

        let plan;
        try {
          plan = await this.gpt.planTurn({
            memory: this.memory,
            round: this.round,
            maxRounds: this.maxRounds,
            gitContext,
            lastCursorResult,
            userReply,
            onDelta: (chunk) => {
              this.live.gpt += chunk;
              if (this.live.gpt.length > 12_000) {
                this.live.gpt = this.live.gpt.slice(-12_000);
              }
              this.emit();
            },
          });
        } catch (err) {
          throw err;
        }
        userReply = undefined;

        this.cost = addRoundCost(
          this.cost,
          this.round,
          plan.usage,
          plan.estimatedUsd,
          0,
        );
        this.log(
          "cost",
          `Round ${this.round}: GPT $${plan.estimatedUsd.toFixed(4)} (${plan.usage.totalTokens} tok)`,
          this.round,
        );

        const decision = plan.decision;
        if (decision.notes) {
          this.log("gpt", decision.notes, this.round);
          rememberDecision(this.memory, decision.notes);
        }
        this.log(
          "gpt",
          `status=${decision.status}` +
            (decision.instruction ? `\n${decision.instruction}` : "") +
            (decision.summary ? `\n${decision.summary}` : "") +
            (decision.question ? `\n${decision.question}` : ""),
          this.round,
        );
        this.emit();

        if (decision.status === "complete") {
          this.summary = decision.summary ?? "Task complete.";
          this.nextImprovements = decision.next_improvements ?? [];
          this.status = "completed";
          this.stopReason = "gpt_complete";
          rememberDecision(this.memory, `Complete: ${this.summary}`);
          upsertRound(this.memory, {
            round: this.round,
            decisionNotes: decision.notes,
            stopReason: "gpt_complete",
          });
          this.log("gpt", `COMPLETE\n${this.summary}`, this.round);
          if (this.nextImprovements.length) {
            this.log(
              "gpt",
              `Next improvements:\n${this.nextImprovements.map((i) => `• ${i}`).join("\n")}`,
              this.round,
            );
          }
          break;
        }

        if (decision.status === "needs_user") {
          this.pendingQuestion = decision.question ?? "Need your input.";
          this.status = "awaiting_user";
          this.stopReason = "needs_user";
          this.log("gpt", `NEEDS USER\n${this.pendingQuestion}`, this.round);
          this.emit();
          userReply = await this.waitForUserReply();
          if (this.isStopRequested()) break;
          this.stopReason = null;
          lastCursorResult = undefined;
          continue;
        }

        const instruction = decision.instruction?.trim() ?? "";
        if (!instruction) {
          throw new Error("GPT returned an empty instruction");
        }

        // Smarter stop: duplicate instruction before running Cursor
        const preStop = evaluateStopConditions({
          round: this.round,
          maxRounds: this.maxRounds,
          instruction,
          previousInstructions,
          git: this.git,
          previousDiffHash,
          expectChanges: true,
          noChangeStreak,
          testHistory: this.memory.testHistory,
          cursorOk: true,
          cursorText: "",
          rounds: this.memory.rounds,
        });
        if (preStop.stop && preStop.code === "duplicate_instruction") {
          this.finishAsStopped(preStop.code, preStop.message ?? "Duplicate instruction");
          break;
        }

        const scan = detectApprovalNeeds(instruction);
        const needsApproval =
          decision.status === "needs_approval" || scan.categories.length > 0;
        const reason =
          decision.approval_reason ||
          scan.reasons.join("; ") ||
          "Sensitive action requires approval";

        if (needsApproval) {
          const approved = await this.waitForApproval({
            id: randomUUID(),
            round: this.round,
            reason,
            instruction,
            categories:
              scan.categories.length > 0
                ? scan.categories
                : ["push", "deploy", "deletion", "secrets"].filter((c) =>
                    reason.toLowerCase().includes(c),
                  ),
          });
          if (!approved || this.isStopRequested()) {
            this.status = "stopped";
            this.stopReason = "approval_denied";
            this.log("system", "Relay stopped — approval denied or cancelled");
            break;
          }
        }

        await this.waitIfPaused();
        if (this.isStopRequested()) break;

        this.live.cursor = "";
        this.live.cursorActivity = "Starting Cursor…";
        this.log("system", `Round ${this.round}: Cursor Agent (live stream)`);
        this.emit();

        const result = await this.runCursorWithRetries(instruction);
        if (this.isStopRequested()) break;

        if (result.chatId) {
          this.memory.cursorChatId = result.chatId;
        }

        // Update cost with cursor tokens for this round
        const lastRound = this.cost.rounds[this.cost.rounds.length - 1];
        if (lastRound && lastRound.round === this.round) {
          lastRound.cursorTokens = result.estimatedTokens;
        }
        this.cost.cursorTokens += result.estimatedTokens;

        const report = [
          `attempt=${result.attempt}`,
          `exitCode=${result.exitCode}`,
          `ok=${result.ok}`,
          `durationMs=${result.durationMs}`,
          result.crashed ? "crashed=true" : null,
          result.timedOut ? "timedOut=true" : null,
          result.stdout ? `stdout:\n${result.stdout}` : "stdout: (empty)",
          result.stderr ? `stderr:\n${result.stderr}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        lastCursorResult = report;
        this.log("cursor", report, this.round);

        const testSummary = extractTestSummary(`${result.stdout}\n${result.stderr}`);
        if (testSummary) rememberTestResult(this.memory, testSummary);

        // Git after Cursor — feed next GPT turn
        this.git = await this.collectGitSnapshotFn(this.projectPath);
        mergeChangedFiles(this.memory, this.git.files);
        if (this.git.files.length === 0) noChangeStreak += 1;
        else noChangeStreak = 0;

        upsertRound(this.memory, {
          round: this.round,
          instruction,
          cursorOk: result.ok,
          cursorSummary: result.stdout.slice(0, 500) || result.stderr.slice(0, 500),
          testSummary: testSummary ?? undefined,
          git: {
            filesChanged: this.git.files.length,
            additions: this.git.additions,
            deletions: this.git.deletions,
            diffHash: this.git.diffHash,
          },
        });

        const stop = evaluateStopConditions({
          round: this.round,
          maxRounds: this.maxRounds,
          instruction,
          previousInstructions,
          git: this.git,
          previousDiffHash,
          expectChanges: true,
          noChangeStreak,
          testHistory: this.memory.testHistory,
          cursorOk: result.ok,
          cursorText: `${result.stdout}\n${result.stderr}`,
          rounds: this.memory.rounds,
        });

        previousInstructions.push(instruction);
        previousDiffHash = this.git.diffHash || previousDiffHash;

        this.log("cost", formatCostSummary(this.cost), this.round);
        this.emit();

        if (stop.stop) {
          this.finishAsStopped(
            stop.code ?? "safety",
            stop.message ?? "Safety stop triggered",
          );
          break;
        }
        // Auto-continue — no Continue button required.
      }
    } catch (err) {
      if (this.status !== "stopped") {
        this.status = "error";
        this.error = err instanceof Error ? err.message : String(err);
        this.log("system", `Error: ${this.error}`);
      }
    } finally {
      try {
        this.git = await this.collectGitSnapshotFn(this.projectPath);
        mergeChangedFiles(this.memory, this.git.files);
      } catch {
        // keep prior
      }
      if (this.status === "running" || this.status === "paused") {
        this.status = "stopped";
      }
      if (this.status === "completed" && !this.summary) {
        this.summary = "Relay finished.";
      }
      if (
        this.status === "completed" ||
        this.status === "error" ||
        this.status === "stopped"
      ) {
        const files = this.git?.files ?? [];
        this.log(
          "system",
          `Finished status=${this.status}` +
            (this.stopReason ? ` · stop=${this.stopReason}` : "") +
            `\n${formatCostSummary(this.cost)}` +
            (files.length
              ? `\nChanged files (${files.length}):\n` +
                files.map((f) => `${kindGlyph(f.kind)} ${f.path}`).join("\n")
              : "\nChanged files: none detected") +
            (this.nextImprovements.length
              ? `\nNext improvements:\n${this.nextImprovements.map((i) => `• ${i}`).join("\n")}`
              : ""),
        );
      }
      this.live.cursorActivity = "";
      this.emit();
    }
  }

  private async runCursorWithRetries(instruction: string) {
    let attempt = 1;
    let result = await this.cursor.run({
      projectPath: this.projectPath,
      instruction,
      chatId: this.memory.cursorChatId,
      attempt,
      signal: this.abortController?.signal,
      onActivity: (event) => {
        this.live.cursorActivity = event.text;
        if (event.kind === "text" || event.kind === "tool") {
          this.live.cursor += (this.live.cursor ? "\n" : "") + event.text;
          if (this.live.cursor.length > 20_000) {
            this.live.cursor = this.live.cursor.slice(-20_000);
          }
        }
        this.emit();
      },
      onStdout: () => {
        // activity handler covers stream-json; keep emit soft
      },
    });

    while (
      shouldRetryCursor(result) &&
      attempt < MAX_CURSOR_ATTEMPTS &&
      !this.isStopRequested()
    ) {
      attempt += 1;
      this.log(
        "system",
        `Cursor exited unexpectedly. Restarting… Attempt ${attempt}/${MAX_CURSOR_ATTEMPTS}`,
        this.round,
      );
      this.live.cursorActivity = `Restarting Cursor… ${attempt}/${MAX_CURSOR_ATTEMPTS}`;
      this.emit();
      await sleep(250 * attempt);
      result = await this.cursor.run({
        projectPath: this.projectPath,
        instruction,
        chatId: this.memory.cursorChatId,
        attempt,
        signal: this.abortController?.signal,
        onActivity: (event) => {
          this.live.cursorActivity = event.text;
          if (event.kind === "text" || event.kind === "tool") {
            this.live.cursor += (this.live.cursor ? "\n" : "") + event.text;
            if (this.live.cursor.length > 20_000) {
              this.live.cursor = this.live.cursor.slice(-20_000);
            }
          }
          this.emit();
        },
      });
    }

    return result;
  }

  private finishAsStopped(code: string, message: string): void {
    this.status = "completed";
    this.stopReason = code;
    this.summary = message;
    this.log("system", message);
    upsertRound(this.memory, { round: this.round, stopReason: code });
  }

  private async waitIfPaused(): Promise<void> {
    while (this.pauseRequested && this.status !== "stopped") {
      this.status = "paused";
      this.emit();
      await new Promise<void>((resolve) => {
        this.pauseWaiters.push(resolve);
      });
    }
  }

  private waitForApproval(request: ApprovalRequest): Promise<boolean> {
    this.pendingApproval = request;
    this.status = "awaiting_approval";
    this.log(
      "approval",
      `Approval required (${request.categories.join(", ") || "sensitive"}): ${request.reason}`,
      request.round,
    );
    this.emit();
    return new Promise<boolean>((resolve) => {
      this.approvalWaiter = { resolve };
    });
  }

  private waitForUserReply(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.userWaiter = { resolve };
    });
  }

  private log(source: LogEntry["source"], text: string, round?: number): void {
    this.logs.push({
      id: randomUUID(),
      ts: new Date().toISOString(),
      source,
      round,
      text,
    });
    if (this.logs.length > 800) {
      this.logs = this.logs.slice(-800);
    }
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }
}

function kindGlyph(kind: string): string {
  switch (kind) {
    case "added":
      return "+";
    case "removed":
      return "-";
    case "modified":
      return "~";
    case "untracked":
      return "?";
    default:
      return "•";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRelayFromEnv(env: NodeJS.ProcessEnv = process.env): {
  session: RelaySession;
  defaults: {
    maxRounds: number;
    openaiModel: string;
    cursorAgentBin: string;
    port: number;
    hasOpenAiKey: boolean;
  };
} {
  const openaiApiKey = env.OPENAI_API_KEY ?? "";
  const openaiModel = env.OPENAI_MODEL ?? "gpt-4.1";
  const cursorAgentBin = env.CURSOR_AGENT_BIN ?? "agent";
  const cursorApiKey = env.CURSOR_API_KEY;
  const maxRounds = Number(env.MAX_ROUNDS ?? 12) || 12;
  const port = Number(env.PORT ?? 8787) || 8787;

  const gpt = new GptClient({ apiKey: openaiApiKey, model: openaiModel });
  const cursor = new CursorRunner({
    agentBin: cursorAgentBin,
    apiKey: cursorApiKey,
  });
  const session = new RelaySession({ gpt, cursor });

  return {
    session,
    defaults: {
      maxRounds,
      openaiModel,
      cursorAgentBin,
      port,
      hasOpenAiKey: Boolean(openaiApiKey),
    },
  };
}
