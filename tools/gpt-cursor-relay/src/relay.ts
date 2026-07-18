import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { detectApprovalNeeds } from "./approval.js";
import { CursorRunner } from "./cursor.js";
import { listChangedFiles } from "./git.js";
import { GptClient } from "./gpt.js";
import type {
  ApprovalRequest,
  ChangedFile,
  LogEntry,
  RelayConfig,
  RelaySnapshot,
  RelayStatus,
} from "./types.js";

type Listener = (snapshot: RelaySnapshot) => void;

export interface RelayDependencies {
  gpt: GptClient;
  cursor: CursorRunner;
  listChangedFiles?: typeof listChangedFiles;
}

export class RelaySession {
  private status: RelayStatus = "idle";
  private round = 0;
  private maxRounds = 8;
  private projectPath = "";
  private task = "";
  private logs: LogEntry[] = [];
  private pendingApproval: ApprovalRequest | null = null;
  private pendingQuestion: string | null = null;
  private summary: string | null = null;
  private changedFiles: ChangedFile[] = [];
  private error: string | null = null;
  private listeners = new Set<Listener>();
  private abortController: AbortController | null = null;
  private pauseRequested = false;
  private pauseWaiters: Array<() => void> = [];
  private approvalWaiter: {
    resolve: (approved: boolean) => void;
  } | null = null;
  private userWaiter: {
    resolve: (reply: string) => void;
  } | null = null;
  private loopPromise: Promise<void> | null = null;
  private readonly gpt: GptClient;
  private readonly cursor: CursorRunner;
  private readonly listChangedFilesFn: typeof listChangedFiles;

  constructor(deps: RelayDependencies) {
    this.gpt = deps.gpt;
    this.cursor = deps.cursor;
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
      task: this.task,
      logs: [...this.logs],
      pendingApproval: this.pendingApproval,
      pendingQuestion: this.pendingQuestion,
      summary: this.summary,
      changedFiles: [...this.changedFiles],
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
    this.task = config.task.trim();
    this.maxRounds = Math.max(1, Math.min(50, config.maxRounds || 8));
    this.round = 0;
    this.logs = [];
    this.pendingApproval = null;
    this.pendingQuestion = null;
    this.summary = null;
    this.changedFiles = [];
    this.error = null;
    this.pauseRequested = false;
    this.status = "running";
    this.abortController = new AbortController();
    this.log("system", `Starting relay in ${this.projectPath}`);
    this.log("system", `Task: ${this.task}`);
    this.log("system", `Max rounds: ${this.maxRounds}`);
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
    this.pendingQuestion = null;
    this.status = "running";
    const waiter = this.userWaiter;
    this.userWaiter = null;
    this.emit();
    waiter.resolve(text);
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

    try {
      while (this.isLoopOpen()) {
        await this.waitIfPaused();
        if (this.isStopRequested()) break;

        this.round += 1;
        if (this.round > this.maxRounds) {
          this.status = "completed";
          this.summary =
            `Stopped after max rounds (${this.maxRounds}). ` +
            "Review the log and continue manually if needed.";
          this.log("system", this.summary);
          break;
        }

        this.log("system", `Round ${this.round}: asking GPT for next instruction`);
        this.emit();

        const decision = await this.gpt.planTurn({
          task: this.task,
          projectPath: this.projectPath,
          round: this.round,
          maxRounds: this.maxRounds,
          recentLogs: this.logs,
          lastCursorResult,
          userReply,
        });
        userReply = undefined;

        if (decision.notes) {
          this.log("gpt", decision.notes, this.round);
        }

        if (decision.status === "complete") {
          this.summary = decision.summary ?? "Task complete.";
          this.status = "completed";
          this.log("gpt", `COMPLETE\n${this.summary}`, this.round);
          break;
        }

        if (decision.status === "ask") {
          this.pendingQuestion = decision.question ?? "Need your input.";
          this.status = "awaiting_user";
          this.log("gpt", `QUESTION\n${this.pendingQuestion}`, this.round);
          this.emit();
          userReply = await this.waitForUserReply();
          if (this.isStopRequested()) break;
          lastCursorResult = undefined;
          continue;
        }

        const instruction = decision.instruction?.trim() ?? "";
        if (!instruction) {
          throw new Error("GPT returned an empty instruction");
        }

        const scan = detectApprovalNeeds(instruction);
        const needsApproval =
          decision.status === "needs_approval" || scan.categories.length > 0;
        const reason =
          decision.approval_reason ||
          scan.reasons.join("; ") ||
          "Sensitive action requires approval";

        this.log("gpt", `Instruction for Cursor:\n${instruction}`, this.round);

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
            this.log("system", "Relay stopped — approval denied or cancelled");
            break;
          }
        }

        await this.waitIfPaused();
        if (this.isStopRequested()) break;

        this.log("system", `Round ${this.round}: running Cursor Agent CLI`);
        this.emit();

        const result = await this.cursor.run({
          projectPath: this.projectPath,
          instruction,
          signal: this.abortController?.signal,
          onStdout: (chunk) => {
            // Stream coarse progress without flooding the notepad.
            if (chunk.includes("\n")) {
              const line = chunk.trim();
              if (line) this.log("cursor", line.slice(0, 2000), this.round);
            }
          },
        });

        if (this.isStopRequested()) break;

        const report = [
          `exitCode=${result.exitCode}`,
          `ok=${result.ok}`,
          `durationMs=${result.durationMs}`,
          result.timedOut ? "timedOut=true" : null,
          result.stdout ? `stdout:\n${result.stdout}` : "stdout: (empty)",
          result.stderr ? `stderr:\n${result.stderr}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        lastCursorResult = report;
        this.log("cursor", report, this.round);
        this.changedFiles = await this.listChangedFilesFn(this.projectPath);
        this.emit();
      }
    } catch (err) {
      if (this.status !== "stopped") {
        this.status = "error";
        this.error = err instanceof Error ? err.message : String(err);
        this.log("system", `Error: ${this.error}`);
      }
    } finally {
      this.changedFiles = await this.listChangedFilesFn(this.projectPath).catch(
        () => this.changedFiles,
      );
      if (this.status === "running" || this.status === "paused") {
        this.status = "stopped";
      }
      if (this.status === "completed" && !this.summary) {
        this.summary = "Relay finished.";
      }
      if (this.status === "completed" || this.status === "error" || this.status === "stopped") {
        this.log(
          "system",
          `Finished with status=${this.status}` +
            (this.changedFiles.length
              ? `\nChanged files (${this.changedFiles.length}):\n` +
                this.changedFiles
                  .map((f) => `${f.status} ${f.path}`)
                  .join("\n")
              : "\nChanged files: none detected"),
        );
      }
      this.emit();
    }
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
    // Keep notepad bounded.
    if (this.logs.length > 500) {
      this.logs = this.logs.slice(-500);
    }
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }
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
  const maxRounds = Number(env.MAX_ROUNDS ?? 8) || 8;
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
