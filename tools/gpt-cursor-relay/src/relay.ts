import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { adaptCursorRunner, type CodingAgent } from "./agent.js";
import { detectApprovalNeeds } from "./approval.js";
import { createCheckpoint, rollbackToCheckpoint } from "./checkpoint.js";
import {
  conflictAwareMergeInstruction,
  detectWorkerConflicts,
} from "./conflicts.js";
import type { ApprovalPolicy, ProjectRelayConfig } from "./config.js";
import { DEFAULT_APPROVAL, loadProjectConfig } from "./config.js";
import { addRoundCost, emptyCost, formatCostSummary } from "./cost.js";
import { CursorRunner } from "./cursor.js";
import {
  collectGitSnapshot,
  formatGitForPrompt,
} from "./git.js";
import { enrichGitIntel, heuristicGitIntel } from "./git-intel.js";
import { GptClient } from "./gpt.js";
import {
  createSessionMemory,
  extractTestSummary,
  mergeChangedFiles,
  rememberDecision,
  rememberTestResult,
  upsertRound,
} from "./memory.js";
import { recordTaskMetric } from "./metrics.js";
import {
  formatLongMemoryForPrompt,
  loadProjectMemory,
  rememberSessionEnd,
} from "./persist.js";
import { discoverPlugins } from "./plugins/loader.js";
import type { OrchestratorPlugin } from "./plugins/types.js";
import {
  clearRecoverableSession,
  formatRecoverySummary,
  loadRecoverableSession,
  saveRecoverableSession,
  type RecoverableSession,
} from "./recovery.js";
import { evaluateStopConditions, shouldRetryCursor } from "./stop.js";
import { shouldSuperviseActivity, superviseActivity } from "./supervisor.js";
import { Timeline } from "./timeline.js";
import {
  formatVerifyForPrompt,
  runVerification,
} from "./verify.js";
import {
  cleanupWorkerTrees,
  formatWorkersForPrompt,
  runParallelWorkers,
} from "./workers.js";
import type {
  ApprovalRequest,
  CostBreakdown,
  ExecutionPlan,
  GitIntelligence,
  GitSnapshot,
  LiveStreams,
  LogEntry,
  RelayConfig,
  RelaySnapshot,
  RelayStatus,
  RollbackCheckpoint,
  SessionMemory,
  SupervisorEvent,
  VerifyResult,
  WorkerResult,
} from "./types.js";

type Listener = (snapshot: RelaySnapshot) => void;

const MAX_CURSOR_ATTEMPTS = 3;

export interface RelayDependencies {
  gpt: GptClient;
  cursor: CursorRunner;
  collectGitSnapshot?: typeof collectGitSnapshot;
  runVerification?: typeof runVerification;
  runParallelWorkers?: typeof runParallelWorkers;
  createCheckpoint?: typeof createCheckpoint;
  rollbackToCheckpoint?: typeof rollbackToCheckpoint;
  loadProjectMemory?: typeof loadProjectMemory;
  rememberSessionEnd?: typeof rememberSessionEnd;
}

export class RelaySession {
  private status: RelayStatus = "idle";
  private round = 0;
  private maxRounds = 12;
  private projectPath = "";
  private projectName = "";
  private task = "";
  private logs: LogEntry[] = [];
  private pendingApproval: ApprovalRequest | null = null;
  private pendingQuestion: string | null = null;
  private pendingPlan: ExecutionPlan | null = null;
  private summary: string | null = null;
  private nextImprovements: string[] = [];
  private git: GitSnapshot | null = null;
  private gitIntel: GitIntelligence | null = null;
  private verification: VerifyResult | null = null;
  private workers: WorkerResult[] = [];
  private supervisorLog: SupervisorEvent[] = [];
  private cost: CostBreakdown = emptyCost();
  private live: LiveStreams = {
    gpt: "",
    cursor: "",
    cursorActivity: "",
    workers: {},
  };
  private memory: SessionMemory = createSessionMemory("", "");
  private checkpoint: RollbackCheckpoint | null = null;
  private stopReason: string | null = null;
  private error: string | null = null;
  private requirePlanApproval = true;
  private supervisorEnabled = true;
  private autoVerify = true;
  private browserVerify = false;
  private planApproved = false;
  private longMemoryContext = "";
  private sessionId: string | null = null;
  private startedAtMs = 0;
  private verifyFailureCount = 0;
  private timeline = new Timeline();
  private plugins: OrchestratorPlugin[] = [];
  private pluginIds: string[] = [];
  private configSource: string | null = null;
  private approvalPolicy: ApprovalPolicy = { ...DEFAULT_APPROVAL };
  private projectConfig: ProjectRelayConfig | null = null;
  private agent: CodingAgent;
  private listeners = new Set<Listener>();
  private abortController: AbortController | null = null;
  private cursorAbort: AbortController | null = null;
  private pauseRequested = false;
  private pauseWaiters: Array<() => void> = [];
  private approvalWaiter: { resolve: (approved: boolean) => void } | null = null;
  private userWaiter: { resolve: (reply: string) => void } | null = null;
  private planWaiter: { resolve: (approved: boolean) => void } | null = null;
  private loopPromise: Promise<void> | null = null;
  private readonly gpt: GptClient;
  private readonly cursor: CursorRunner;
  private readonly collectGitSnapshotFn: typeof collectGitSnapshot;
  private readonly runVerificationFn: typeof runVerification;
  private readonly runParallelWorkersFn: typeof runParallelWorkers;
  private readonly createCheckpointFn: typeof createCheckpoint;
  private readonly rollbackToCheckpointFn: typeof rollbackToCheckpoint;
  private readonly loadProjectMemoryFn: typeof loadProjectMemory;
  private readonly rememberSessionEndFn: typeof rememberSessionEnd;

  constructor(deps: RelayDependencies) {
    this.gpt = deps.gpt;
    this.cursor = deps.cursor;
    this.agent = adaptCursorRunner(deps.cursor);
    this.collectGitSnapshotFn = deps.collectGitSnapshot ?? collectGitSnapshot;
    this.runVerificationFn = deps.runVerification ?? runVerification;
    this.runParallelWorkersFn = deps.runParallelWorkers ?? runParallelWorkers;
    this.createCheckpointFn = deps.createCheckpoint ?? createCheckpoint;
    this.rollbackToCheckpointFn =
      deps.rollbackToCheckpoint ?? rollbackToCheckpoint;
    this.loadProjectMemoryFn = deps.loadProjectMemory ?? loadProjectMemory;
    this.rememberSessionEndFn = deps.rememberSessionEnd ?? rememberSessionEnd;
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
      pendingPlan: this.pendingPlan,
      summary: this.summary,
      nextImprovements: [...this.nextImprovements],
      changedFiles: [...(this.git?.files ?? this.memory.filesChanged)],
      git: this.git,
      gitIntel: this.gitIntel,
      verification: this.verification,
      workers: [...this.workers],
      supervisorLog: [...this.supervisorLog],
      cost: this.cost,
      live: {
        ...this.live,
        workers: { ...this.live.workers },
      },
      memory: {
        ...this.memory,
        rounds: [...this.memory.rounds],
        filesChanged: [...this.memory.filesChanged],
        testHistory: [...this.memory.testHistory],
        decisions: [...this.memory.decisions],
        style: {
          ...this.memory.style,
          prefers: [...this.memory.style.prefers],
          avoids: [...this.memory.style.avoids],
          notes: [...this.memory.style.notes],
        },
        longMemoryFacts: [...this.memory.longMemoryFacts],
      },
      checkpoint: this.checkpoint,
      canRollback: Boolean(this.checkpoint) && !this.isActive(),
      stopReason: this.stopReason,
      error: this.error,
      flags: {
        requirePlanApproval: this.requirePlanApproval,
        supervisorEnabled: this.supervisorEnabled,
        autoVerify: this.autoVerify,
        browserVerify: this.browserVerify,
      },
      timeline: this.timeline.all().map((e) => ({
        id: e.id,
        ts: e.ts,
        type: e.type,
        message: e.message,
        round: e.round,
      })),
      plugins: [...this.pluginIds],
      configSource: this.configSource,
      sessionId: this.sessionId,
      agentId: this.agent.id,
    };
  }

  async start(config: RelayConfig): Promise<void> {
    if (this.loopPromise) throw new Error("Relay already active");
    if (!config.task.trim()) throw new Error("Task is required");
    if (!config.projectPath.trim()) throw new Error("Project folder is required");
    await access(config.projectPath, fsConstants.R_OK);

    this.projectPath = config.projectPath;
    this.projectName = path.basename(config.projectPath) || config.projectPath;
    this.task = config.task.trim();
    this.maxRounds = Math.max(1, Math.min(50, config.maxRounds || 12));

    const loaded = await loadProjectConfig(this.projectPath);
    this.projectConfig = loaded.config;
    this.configSource = loaded.source;
    this.approvalPolicy = { ...DEFAULT_APPROVAL, ...loaded.config.approval };

    // CLI/UI flags override config when explicitly provided
    this.requirePlanApproval =
      config.requirePlanApproval ?? loaded.config.require_plan_approval ?? true;
    this.supervisorEnabled =
      config.supervisorEnabled ?? loaded.config.supervisor ?? true;
    this.autoVerify = config.autoVerify ?? loaded.config.auto_verify ?? true;
    this.browserVerify =
      config.browserVerify ?? loaded.config.browser_verify ?? false;

    const discovered = await discoverPlugins(
      this.projectPath,
      loaded.config.plugins,
    );
    this.plugins = discovered.active;
    this.pluginIds = discovered.active.map((p) => p.id);

    this.planApproved = !this.requirePlanApproval;
    this.round = 0;
    this.logs = [];
    this.pendingApproval = null;
    this.pendingQuestion = null;
    this.pendingPlan = null;
    this.summary = null;
    this.nextImprovements = [];
    this.git = null;
    this.gitIntel = null;
    this.verification = null;
    this.workers = [];
    this.supervisorLog = [];
    this.cost = emptyCost();
    this.live = { gpt: "", cursor: "", cursorActivity: "", workers: {} };
    this.stopReason = null;
    this.error = null;
    this.pauseRequested = false;
    this.verifyFailureCount = 0;
    this.sessionId = randomUUID();
    this.startedAtMs = Date.now();
    this.timeline.clear();
    this.status = this.requirePlanApproval ? "planning" : "running";
    this.abortController = new AbortController();
    this.gpt.resetConversation();

    const long = await this.loadProjectMemoryFn(this.projectPath);
    this.longMemoryContext = formatLongMemoryForPrompt(long);
    this.memory = createSessionMemory(this.task, this.projectPath, {
      style: long.style,
      longMemoryFacts: long.facts.slice(-12),
    });

    this.checkpoint = await this.createCheckpointFn(
      this.projectPath,
      this.task.slice(0, 80),
    );
    this.log("system", `Orchestrator started · ${this.projectName}`);
    this.log("system", `Task: ${this.task}`);
    this.log(
      "system",
      `Agent=${this.agent.displayName} · config=${this.configSource ?? "(defaults)"} · plugins=${this.pluginIds.join(", ") || "(none)"}`,
    );
    this.log(
      "system",
      `Flags: plan=${this.requirePlanApproval} supervisor=${this.supervisorEnabled} verify=${this.autoVerify} browser=${this.browserVerify}`,
    );
    this.log("system", `Checkpoint ${this.checkpoint.headSha.slice(0, 8)} ready for rollback`);
    this.timeline.add("session_start", `Started task in ${this.projectName}`, {
      meta: { sessionId: this.sessionId, plugins: this.pluginIds },
    });
    if (long.style.prefers.length) {
      this.log(
        "style",
        long.style.prefers.map((p) => `✓ ${p}`).join("\n"),
      );
    }
    await this.persistRecovery();
    this.emit();

    this.loopPromise = this.runLoop().finally(() => {
      this.loopPromise = null;
      this.abortController = null;
      this.cursorAbort = null;
    });
    await this.loopPromise;
  }

  /** Resume a crash-recovered session (continues the autonomous loop). */
  async resumeRecovered(sessionId: string): Promise<void> {
    if (this.loopPromise) throw new Error("Relay already active");
    const saved = await loadRecoverableSession(sessionId);
    if (!saved) throw new Error(`No recoverable session ${sessionId}`);

    this.sessionId = saved.sessionId;
    this.projectPath = saved.projectPath;
    this.projectName = saved.projectName;
    this.task = saved.task;
    this.round = saved.round;
    this.maxRounds = saved.maxRounds;
    this.planApproved = saved.planApproved;
    this.pendingPlan = saved.pendingPlan;
    this.workers = saved.workers;
    this.checkpoint = saved.checkpoint;
    this.summary = saved.summary;
    this.stopReason = null;
    this.error = null;
    this.requirePlanApproval = saved.flags.requirePlanApproval;
    this.supervisorEnabled = saved.flags.supervisorEnabled;
    this.autoVerify = saved.flags.autoVerify;
    this.browserVerify = saved.flags.browserVerify;
    this.timeline.load(saved.timeline);
    this.memory = createSessionMemory(this.task, this.projectPath);
    this.memory.rounds = saved.rounds;
    this.memory.cursorChatId = saved.cursorChatId;
    this.pluginIds = saved.plugins;
    this.startedAtMs = Date.now();
    // Resume continues execution; skip re-prompting for an already-seen plan.
    this.planApproved = true;
    this.pendingPlan = null;
    this.status = "running";
    this.abortController = new AbortController();
    this.gpt.resetConversation();

    const loaded = await loadProjectConfig(this.projectPath);
    this.projectConfig = loaded.config;
    this.configSource = loaded.source;
    this.approvalPolicy = { ...DEFAULT_APPROVAL, ...loaded.config.approval };
    const discovered = await discoverPlugins(this.projectPath, saved.plugins);
    this.plugins = discovered.active;

    this.log("system", "Recovered session — resuming autonomous loop");
    this.log("system", formatRecoverySummary(saved));
    this.timeline.add("recovery_resumed", `Resumed session ${sessionId.slice(0, 8)}`);
    this.emit();

    this.loopPromise = this.runLoop().finally(() => {
      this.loopPromise = null;
      this.abortController = null;
      this.cursorAbort = null;
    });
    await this.loopPromise;
  }

  pause(): void {
    if (this.status !== "running" && this.status !== "verifying") return;
    this.pauseRequested = true;
    this.status = "paused";
    this.log("system", "Pause requested");
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
    this.approvalWaiter?.resolve(false);
    this.approvalWaiter = null;
    this.userWaiter?.resolve("");
    this.userWaiter = null;
    this.planWaiter?.resolve(false);
    this.planWaiter = null;
    this.cursorAbort?.abort();
    this.abortController?.abort();
    this.emit();
    if (this.loopPromise) await this.loopPromise.catch(() => undefined);
  }

  resolveApproval(approved: boolean): void {
    if (!this.approvalWaiter || !this.pendingApproval) {
      throw new Error("No pending approval");
    }
    this.log(
      "approval",
      approved
        ? `Approved: ${this.pendingApproval.reason}`
        : `Denied: ${this.pendingApproval.reason}`,
    );
    this.pendingApproval = null;
    this.status = approved ? "running" : "stopped";
    if (!approved) this.stopReason = "approval_denied";
    const waiter = this.approvalWaiter;
    this.approvalWaiter = null;
    this.emit();
    waiter.resolve(approved);
  }

  resolvePlan(approved: boolean): void {
    if (!this.planWaiter || !this.pendingPlan) {
      throw new Error("No pending plan");
    }
    this.log(
      "user",
      approved
        ? `Plan approved: ${this.pendingPlan.title}`
        : `Plan rejected: ${this.pendingPlan.title}`,
    );
    if (approved) {
      this.planApproved = true;
      rememberDecision(this.memory, `Approved plan: ${this.pendingPlan.title}`);
      this.timeline.add("plan_approved", `Plan approved: ${this.pendingPlan.title}`);
    } else {
      this.stopReason = "plan_rejected";
      this.status = "stopped";
      this.timeline.add("plan_rejected", `Plan rejected: ${this.pendingPlan.title}`);
    }
    this.pendingPlan = null;
    if (approved) this.status = "running";
    const waiter = this.planWaiter;
    this.planWaiter = null;
    this.emit();
    waiter.resolve(approved);
  }

  answerQuestion(reply: string): void {
    if (!this.userWaiter || !this.pendingQuestion) {
      throw new Error("No pending question");
    }
    const text = reply.trim();
    if (!text) throw new Error("Reply is required");
    this.log("user", text);
    rememberDecision(this.memory, `User answered: ${text.slice(0, 200)}`);
    this.pendingQuestion = null;
    this.status = "running";
    const waiter = this.userWaiter;
    this.userWaiter = null;
    this.emit();
    waiter.resolve(text);
  }

  async rollback(): Promise<{ ok: boolean; message: string }> {
    if (this.isActive()) {
      throw new Error("Stop the run before rolling back");
    }
    if (!this.checkpoint) {
      throw new Error("No checkpoint available");
    }
    const result = await this.rollbackToCheckpointFn(this.checkpoint);
    this.log("system", result.message);
    if (result.ok) {
      this.git = await this.collectGitSnapshotFn(this.projectPath);
      this.gitIntel = heuristicGitIntel(this.git);
      this.summary = `Rolled back: ${result.message}`;
      this.status = "stopped";
      this.stopReason = "rollback";
    }
    this.emit();
    return result;
  }

  async continueWithImprovements(): Promise<void> {
    if (this.status !== "completed" || !this.nextImprovements.length) {
      throw new Error("No next improvements to continue with");
    }
    const followUp = this.nextImprovements
      .map((i, n) => `${n + 1}. ${i}`)
      .join("\n");
    const prior = this.task;
    await this.start({
      projectPath: this.projectPath,
      task: `Continue from prior completed task (${prior}). Implement these next improvements:\n${followUp}`,
      maxRounds: this.maxRounds,
      openaiApiKey: "",
      openaiModel: "",
      cursorAgentBin: "",
      requirePlanApproval: this.requirePlanApproval,
      supervisorEnabled: this.supervisorEnabled,
      autoVerify: this.autoVerify,
      browserVerify: this.browserVerify,
    });
  }

  private isActive(): boolean {
    return [
      "planning",
      "awaiting_plan",
      "running",
      "paused",
      "awaiting_approval",
      "awaiting_user",
      "verifying",
      "supervising",
    ].includes(this.status);
  }

  private isStopRequested(): boolean {
    return this.status === "stopped";
  }

  private isLoopOpen(): boolean {
    return (
      this.status === "running" ||
      this.status === "paused" ||
      this.status === "planning" ||
      this.status === "verifying" ||
      this.status === "supervising"
    );
  }

  private async runLoop(): Promise<void> {
    let lastCursorResult: string | undefined;
    let userReply: string | undefined;
    let verifyContext: string | undefined;
    let workerContext: string | undefined;
    let previousDiffHash: string | null = null;
    let noChangeStreak = 0;
    const previousInstructions: string[] = [];

    try {
      this.git = await this.collectGitSnapshotFn(this.projectPath);
      this.gitIntel = heuristicGitIntel(this.git);
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

        this.live.gpt = "";
        this.live.cursorActivity = "Waiting for GPT…";
        if (this.status === "planning") this.status = "planning";
        else if (this.status !== "paused") this.status = "running";
        this.log("system", `Round ${this.round}: supervisor planning`);
        this.emit();

        this.git = await this.collectGitSnapshotFn(this.projectPath);
        this.gitIntel = await enrichGitIntel(this.gpt, this.git).catch(() =>
          heuristicGitIntel(this.git!),
        );
        this.log(
          "git",
          `${this.gitIntel.theme} · ${this.git.files.length} files · risk=${this.gitIntel.risk}\n` +
            this.gitIntel.bullets.join("\n") +
            `\nBreaking: ${this.gitIntel.breakingChanges}\nMigration: ${this.gitIntel.migration}`,
          this.round,
        );
        this.emit();

        const plan = await this.gpt.planTurn({
          memory: this.memory,
          round: this.round,
          maxRounds: this.maxRounds,
          gitContext: formatGitForPrompt(this.git),
          verifyContext,
          workerContext,
          lastCursorResult,
          userReply,
          longMemoryContext: this.longMemoryContext,
          requirePlan: this.requirePlanApproval,
          planAlreadyApproved: this.planApproved,
          onDelta: (chunk) => {
            this.live.gpt += chunk;
            if (this.live.gpt.length > 12_000) {
              this.live.gpt = this.live.gpt.slice(-12_000);
            }
            this.emit();
          },
        });
        userReply = undefined;
        workerContext = undefined;

        this.cost = addRoundCost(
          this.cost,
          this.round,
          plan.usage,
          plan.estimatedUsd,
          0,
        );
        this.log(
          "cost",
          `Round ${this.round}: GPT $${plan.estimatedUsd.toFixed(4)}`,
          this.round,
        );

        const decision = plan.decision;
        if (decision.notes) {
          this.log("gpt", decision.notes, this.round);
          rememberDecision(this.memory, decision.notes);
        }

        if (decision.status === "plan" && decision.plan) {
          this.pendingPlan = decision.plan;
          this.status = "awaiting_plan";
          this.log(
            "gpt",
            `PLAN: ${decision.plan.title}\n` +
              decision.plan.steps
                .map((s) => `${s.id}. ${s.title} — ${s.detail}`)
                .join("\n") +
              `\nEstimated: ${decision.plan.estimatedMinutes} min · Risk: ${decision.plan.risk}` +
              `\nFiles likely: ${decision.plan.filesLikelyTouched.join(", ") || "(unspecified)"}`,
            this.round,
          );
          this.emit();
          const approved = await this.waitForPlan();
          if (!approved || this.isStopRequested()) break;
          lastCursorResult = undefined;
          continue;
        }

        if (decision.status === "complete") {
          // Don't complete without verification when enabled
          if (this.autoVerify && !this.verification) {
            this.status = "verifying";
            this.timeline.add("verify_started", "Automatic verification", {
              round: this.round,
            });
            this.verification = await this.runVerify();
            verifyContext = formatVerifyForPrompt(this.verification);
            this.log("verify", this.verification.summary, this.round);
            this.timeline.add(
              "verify_finished",
              this.verification.ok
                ? "Verification passed"
                : "Verification failed",
              { round: this.round },
            );
            const opinion = await this.gpt.verifyOpinion({
              task: this.task,
              cursorSummary: lastCursorResult ?? decision.summary ?? "",
              verifyReport: verifyContext,
            });
            this.log(
              "gpt",
              `Verify opinion: accepts=${opinion.accepts} — ${opinion.notes}`,
              this.round,
            );
            if (!opinion.accepts || !this.verification.ok) {
              this.verifyFailureCount += 1;
              lastCursorResult = `Verification failed.\n${verifyContext}\nSupervisor notes: ${opinion.notes}`;
              this.status = "running";
              await this.persistRecovery();
              this.emit();
              continue;
            }
          }
          this.summary = decision.summary ?? "Task complete.";
          this.nextImprovements = decision.next_improvements ?? [];
          this.status = "completed";
          this.stopReason = "gpt_complete";
          this.timeline.add("session_end", "Task complete", {
            round: this.round,
          });
          rememberDecision(this.memory, `Complete: ${this.summary}`);
          break;
        }

        if (decision.status === "needs_user") {
          this.pendingQuestion = decision.question ?? "Need your input.";
          this.status = "awaiting_user";
          this.log("gpt", `NEEDS USER\n${this.pendingQuestion}`, this.round);
          this.emit();
          userReply = await this.waitForUserReply();
          if (this.isStopRequested()) break;
          lastCursorResult = undefined;
          continue;
        }

        if (decision.status === "parallel" && decision.workers?.length) {
          await this.runParallelPhase(decision.workers, decision.merge_instruction);
          if (this.isStopRequested()) break;
          workerContext = formatWorkersForPrompt(this.workers);
          lastCursorResult = workerContext;
          continue;
        }

        const instruction = decision.instruction?.trim() ?? "";
        if (!instruction) throw new Error("GPT returned an empty instruction");

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
          this.finishAsStopped(
            preStop.code,
            preStop.message ?? "Duplicate instruction",
          );
          break;
        }

        const scan = detectApprovalNeeds(instruction, this.approvalPolicy);
        const needsApproval =
          decision.status === "needs_approval" || scan.categories.length > 0;
        if (needsApproval) {
          const reason =
            decision.approval_reason ||
            scan.reasons.join("; ") ||
            "Sensitive action requires approval";
          const approved = await this.waitForApproval({
            id: randomUUID(),
            round: this.round,
            reason,
            instruction,
            categories: scan.categories.length
              ? scan.categories
              : ["push", "deploy", "deletion", "secrets"],
          });
          if (!approved || this.isStopRequested()) {
            this.status = "stopped";
            this.stopReason = "approval_denied";
            break;
          }
        }

        await this.waitIfPaused();
        if (this.isStopRequested()) break;

        const result = await this.runCursorSupervised(instruction);
        if (this.isStopRequested()) break;

        if (result.chatId) this.memory.cursorChatId = result.chatId;
        const lastRound = this.cost.rounds[this.cost.rounds.length - 1];
        if (lastRound?.round === this.round) {
          lastRound.cursorTokens = result.estimatedTokens;
        }
        this.cost.cursorTokens += result.estimatedTokens;

        lastCursorResult = [
          `ok=${result.ok} exit=${result.exitCode} attempt=${result.attempt}`,
          result.stdout || "(empty stdout)",
          result.stderr ? `stderr:\n${result.stderr}` : "",
        ].join("\n");
        this.log("cursor", lastCursorResult, this.round);

        const testSummary = extractTestSummary(
          `${result.stdout}\n${result.stderr}`,
        );
        if (testSummary) rememberTestResult(this.memory, testSummary);

        if (this.autoVerify) {
          this.status = "verifying";
          this.live.cursorActivity = "Running automatic verification…";
          this.timeline.add("verify_started", "Automatic verification", {
            round: this.round,
          });
          this.emit();
          this.verification = await this.runVerify();
          verifyContext = formatVerifyForPrompt(this.verification);
          this.log("verify", this.verification.summary, this.round);
          this.timeline.add(
            "verify_finished",
            this.verification.ok
              ? "Verification passed"
              : "Verification failed",
            { round: this.round },
          );
          if (!this.verification.ok) this.verifyFailureCount += 1;
          const opinion = await this.gpt.verifyOpinion({
            task: this.task,
            cursorSummary: result.stdout,
            verifyReport: verifyContext,
          });
          this.log(
            "gpt",
            `Verify opinion: accepts=${opinion.accepts} — ${opinion.notes}`,
            this.round,
          );
          lastCursorResult += `\n\nVERIFICATION:\n${verifyContext}\nOpinion: ${opinion.notes}`;
          if (!this.isStopRequested()) this.status = "running";
        }
        await this.persistRecovery();

        this.git = await this.collectGitSnapshotFn(this.projectPath);
        this.gitIntel = await enrichGitIntel(this.gpt, this.git).catch(() =>
          heuristicGitIntel(this.git!),
        );
        mergeChangedFiles(this.memory, this.git.files);
        if (this.git.files.length === 0) noChangeStreak += 1;
        else noChangeStreak = 0;

        upsertRound(this.memory, {
          round: this.round,
          instruction,
          cursorOk: result.ok,
          cursorSummary: result.stdout.slice(0, 500),
          testSummary: testSummary ?? undefined,
          verifySummary: this.verification?.summary,
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
        this.emit();

        if (stop.stop) {
          this.finishAsStopped(
            stop.code ?? "safety",
            stop.message ?? "Safety stop",
          );
          break;
        }
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
        this.gitIntel = heuristicGitIntel(this.git);
        mergeChangedFiles(this.memory, this.git.files);
      } catch {
        // keep
      }
      if (this.isLoopOpen() || this.status === "awaiting_plan") {
        if (this.status !== "completed") this.status = "stopped";
      }
      if (this.status === "awaiting_user" || this.status === "awaiting_approval") {
        // keep waiting states only if intentionally left — normally cleared
      }
      if (
        this.status === "completed" ||
        this.status === "error" ||
        this.status === "stopped"
      ) {
        await this.rememberSessionEndFn(
          this.projectPath,
          this.memory,
          this.summary,
        ).catch(() => undefined);
        await this.recordMetricsAndCleanup();
        this.timeline.add(
          "session_end",
          `Finished status=${this.status}` +
            (this.stopReason ? ` · ${this.stopReason}` : ""),
          { round: this.round },
        );
        this.log(
          "system",
          `Finished status=${this.status}` +
            (this.stopReason ? ` · stop=${this.stopReason}` : "") +
            `\n${formatCostSummary(this.cost)}` +
            (this.gitIntel
              ? `\nGit intel: ${this.gitIntel.theme} risk=${this.gitIntel.risk}`
              : "") +
            (this.checkpoint
              ? `\nRollback available → ${this.checkpoint.headSha.slice(0, 8)}`
              : "") +
            (this.sessionId
              ? `\nSession ${this.sessionId.slice(0, 8)} ${
                  this.status === "completed" && this.stopReason === "gpt_complete"
                    ? "cleared"
                    : "saved for recovery"
                }`
              : ""),
        );
      }
      this.live.cursorActivity = "";
      this.emit();
    }
  }

  private async runParallelPhase(
    workers: NonNullable<import("./types.js").GptDecision["workers"]>,
    mergeInstruction?: string,
  ): Promise<void> {
    this.log(
      "worker",
      `Launching ${workers.length} parallel agents:\n` +
        workers.map((w) => `• ${w.role}: ${w.instruction.slice(0, 120)}`).join("\n"),
      this.round,
    );
    for (const w of workers) {
      this.timeline.add("worker_started", `Worker ${w.role} started`, {
        round: this.round,
        meta: { workerId: w.id },
      });
    }
    this.live.workers = {};
    this.emit();

    this.workers = await this.runParallelWorkersFn({
      projectPath: this.projectPath,
      workers,
      agent: this.agent,
      cursor: this.cursor,
      signal: this.abortController?.signal,
      onWorkerActivity: (id, text) => {
        this.live.workers[id] = text;
        this.live.cursorActivity = text;
        this.emit();
      },
    });

    for (const w of this.workers) {
      this.log(
        "worker",
        `[${w.role}] ok=${w.ok} files=${w.filesChanged.length}\n${w.summary.slice(0, 800)}`,
        this.round,
      );
      this.timeline.add(
        "worker_finished",
        `Worker ${w.role} ${w.ok ? "complete" : "failed"}`,
        { round: this.round, meta: { files: w.filesChanged.length } },
      );
    }

    const conflicts = detectWorkerConflicts(this.workers);
    if (!conflicts.clean) {
      this.log("system", conflicts.message, this.round);
      this.timeline.add("conflict_detected", conflicts.message, {
        round: this.round,
      });
    }

    const baseMerge =
      mergeInstruction?.trim() ||
      `Integrate the parallel worker results into the main project. ` +
        `Worker outputs are summarized in the prompt. Resolve conflicts carefully, ` +
        `prefer the smallest coherent merge, then run tests.`;
    const merge = conflictAwareMergeInstruction(baseMerge, conflicts);

    this.log("gpt", `Merge instruction:\n${merge}`, this.round);
    const mergeResult = await this.runCursorSupervised(merge);
    this.log(
      "cursor",
      `Merge ok=${mergeResult.ok}\n${mergeResult.stdout.slice(0, 2000)}`,
      this.round,
    );
    await cleanupWorkerTrees(this.projectPath, this.workers).catch(() => undefined);

    if (this.autoVerify) {
      this.status = "verifying";
      this.verification = await this.runVerify();
      this.log("verify", this.verification.summary, this.round);
      if (!this.verification.ok) this.verifyFailureCount += 1;
      if (!this.isStopRequested()) this.status = "running";
    }
    await this.persistRecovery();
  }

  private async runVerify(): Promise<VerifyResult> {
    return this.runVerificationFn({
      projectPath: this.projectPath,
      browserVerify: this.browserVerify,
      signal: this.abortController?.signal,
      plugins: this.plugins,
      approval: this.approvalPolicy,
    });
  }

  private async persistRecovery(): Promise<void> {
    if (!this.sessionId) return;
    const payload: RecoverableSession = {
      version: 1,
      sessionId: this.sessionId,
      updatedAt: new Date().toISOString(),
      projectPath: this.projectPath,
      projectName: this.projectName,
      task: this.task,
      status: this.status,
      round: this.round,
      maxRounds: this.maxRounds,
      planApproved: this.planApproved,
      pendingPlan: this.pendingPlan,
      workers: this.workers,
      rounds: this.memory.rounds,
      cursorChatId: this.memory.cursorChatId,
      checkpoint: this.checkpoint,
      timeline: this.timeline.all(),
      summary: this.summary,
      stopReason: this.stopReason,
      flags: {
        requirePlanApproval: this.requirePlanApproval,
        supervisorEnabled: this.supervisorEnabled,
        autoVerify: this.autoVerify,
        browserVerify: this.browserVerify,
      },
      plugins: this.pluginIds,
    };
    await saveRecoverableSession(payload).catch(() => undefined);
  }

  private async recordMetricsAndCleanup(): Promise<void> {
    if (!this.sessionId) return;
    const success =
      this.status === "completed" && this.stopReason === "gpt_complete";
    await recordTaskMetric({
      id: this.sessionId,
      projectName: this.projectName,
      task: this.task,
      startedAt: new Date(this.startedAtMs).toISOString(),
      endedAt: new Date().toISOString(),
      status: this.status,
      stopReason: this.stopReason,
      rounds: this.round,
      durationMs: Date.now() - this.startedAtMs,
      costUsd: this.cost.totalUsd,
      verifyFailures: this.verifyFailureCount,
      success,
    }).catch(() => undefined);

    // Keep recovery file on unexpected stop so Resume works; clear on clean complete.
    if (success) {
      await clearRecoverableSession(this.sessionId).catch(() => undefined);
    } else {
      await this.persistRecovery();
    }
  }

  private async runCursorSupervised(instruction: string) {
    let activeInstruction = instruction;
    let attempt = 1;
    let supervisorRedirects = 0;

    while (attempt <= MAX_CURSOR_ATTEMPTS && !this.isStopRequested()) {
      this.live.cursor = "";
      this.live.cursorActivity = "Starting Cursor…";
      this.cursorAbort = new AbortController();
      const linked = AbortSignal.any?.(
        [this.abortController!.signal, this.cursorAbort.signal].filter(
          Boolean,
        ) as AbortSignal[],
      );
      const signal = linked ?? this.cursorAbort.signal;
      let redirected: string | null = null;

      this.log("system", `Cursor run attempt ${attempt}/${MAX_CURSOR_ATTEMPTS}`);
      this.emit();

      const result = await this.cursor.run({
        projectPath: this.projectPath,
        instruction: activeInstruction,
        chatId: this.memory.cursorChatId,
        attempt,
        signal,
        onActivity: (event) => {
          this.live.cursorActivity = event.text;
          if (event.kind === "text" || event.kind === "tool") {
            this.live.cursor += (this.live.cursor ? "\n" : "") + event.text;
            if (this.live.cursor.length > 20_000) {
              this.live.cursor = this.live.cursor.slice(-20_000);
            }
          }
          this.emit();

          if (
            this.supervisorEnabled &&
            !redirected &&
            shouldSuperviseActivity(event.text) &&
            supervisorRedirects < 2
          ) {
            // Fire-and-forget supervise; abort if redirect
            void (async () => {
              try {
                this.status = "supervising";
                this.emit();
                const decision = await superviseActivity(this.gpt, {
                  task: this.task,
                  activity: event.text,
                  currentInstruction: activeInstruction,
                  styleNotes: this.memory.style.prefers.join("; "),
                });
                this.supervisorLog.push({
                  ts: new Date().toISOString(),
                  activity: event.text,
                  decision: decision.decision,
                  reason: decision.reason,
                  redirectInstruction: decision.redirectInstruction,
                });
                this.log(
                  "supervisor",
                  `${decision.decision.toUpperCase()}: ${decision.reason}`,
                  this.round,
                );
                if (
                  decision.decision === "redirect" &&
                  decision.redirectInstruction
                ) {
                  redirected = decision.redirectInstruction;
                  supervisorRedirects += 1;
                  this.cursorAbort?.abort();
                } else if (decision.decision === "stop") {
                  this.cursorAbort?.abort();
                  this.status = "stopped";
                  this.stopReason = "supervisor_stop";
                } else if (this.status === "supervising") {
                  this.status = "running";
                }
                this.emit();
              } catch (err) {
                this.log(
                  "supervisor",
                  `supervise error: ${err instanceof Error ? err.message : String(err)}`,
                  this.round,
                );
                if (this.status === "supervising") this.status = "running";
              }
            })();
          }
        },
      });

      if (redirected && !this.isStopRequested()) {
        this.log(
          "supervisor",
          `Redirecting Cursor:\n${redirected}`,
          this.round,
        );
        activeInstruction = redirected;
        attempt += 1;
        continue;
      }

      if (
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
        await sleep(250 * attempt);
        continue;
      }

      return result;
    }

    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "Cursor attempts exhausted",
      timedOut: false,
      durationMs: 0,
      estimatedTokens: 0,
      crashed: true,
      attempt,
    };
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
      await new Promise<void>((resolve) => this.pauseWaiters.push(resolve));
    }
  }

  private waitForApproval(request: ApprovalRequest): Promise<boolean> {
    this.pendingApproval = request;
    this.status = "awaiting_approval";
    this.log(
      "approval",
      `Approval required: ${request.reason}`,
      request.round,
    );
    this.emit();
    return new Promise((resolve) => {
      this.approvalWaiter = { resolve };
    });
  }

  private waitForPlan(): Promise<boolean> {
    return new Promise((resolve) => {
      this.planWaiter = { resolve };
    });
  }

  private waitForUserReply(): Promise<string> {
    return new Promise((resolve) => {
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
    if (this.logs.length > 900) this.logs = this.logs.slice(-900);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
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
