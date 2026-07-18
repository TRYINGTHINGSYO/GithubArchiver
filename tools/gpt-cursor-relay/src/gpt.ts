import { estimateGptUsd } from "./cost.js";
import { formatMemoryForPrompt } from "./memory.js";
import type {
  ExecutionPlan,
  GitIntelligence,
  GptDecision,
  GptPlanResult,
  SessionMemory,
  SuperviseDecision,
  TokenUsage,
  WorkerSpec,
} from "./types.js";

const SYSTEM_PROMPT = `You are the supervisor/planner of a local AI software engineering orchestrator.

You direct one or more Cursor Agent CLI workers. You do NOT edit files yourself.
The orchestrator streams your decisions and Cursor activity live.

Return ONLY valid JSON:
{
  "status": "plan" | "continue" | "parallel" | "complete" | "needs_user" | "needs_approval",
  "instruction": "string — for continue / needs_approval / merge after parallel",
  "merge_instruction": "string — preferred after parallel workers",
  "question": "string — for needs_user",
  "approval_reason": "string — for needs_approval",
  "summary": "string — for complete",
  "notes": "string — short status",
  "next_improvements": ["string"],
  "plan": {
    "title": "string",
    "steps": [{"id":"1","title":"...","detail":"...","role":"backend|frontend|tests|docs"}],
    "estimatedMinutes": 12,
    "filesLikelyTouched": ["src/..."],
    "risk": "low" | "medium" | "high",
    "notes": "string"
  },
  "workers": [
    {"id":"w1","role":"backend","instruction":"...","focus":["src/lib"]}
  ]
}

Rules:
- On the first turn (or when asked to plan), use status=plan with a concrete plan. Do not edit yet.
- After the plan is approved, use continue or parallel.
- status=parallel: 2–4 specialized workers with non-overlapping focus when possible.
- status=continue: one concrete Cursor instruction. Auto-continues — never ask user to press Continue.
- status=complete: only after verification looks good; include next_improvements.
- status=needs_user: only for true human decisions.
- status=needs_approval: push/deploy/delete/secrets.
- Trust git diff + verification output over Cursor prose.
- Honor coding style preferences and long-term project memory.
`;

export interface GptClientOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface PlanTurnInput {
  memory: SessionMemory;
  round: number;
  maxRounds: number;
  gitContext?: string;
  verifyContext?: string;
  workerContext?: string;
  lastCursorResult?: string;
  userReply?: string;
  longMemoryContext?: string;
  requirePlan?: boolean;
  planAlreadyApproved?: boolean;
  onDelta?: (chunk: string) => void;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("GPT response was not valid JSON");
  }
}

function parsePlan(raw: unknown): ExecutionPlan | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  if (typeof p.title !== "string") return undefined;
  const stepsIn = Array.isArray(p.steps) ? p.steps : [];
  const steps = stepsIn
    .map((s, i) => {
      if (!s || typeof s !== "object") return null;
      const o = s as Record<string, unknown>;
      if (typeof o.title !== "string" || typeof o.detail !== "string") return null;
      return {
        id: typeof o.id === "string" ? o.id : String(i + 1),
        title: o.title,
        detail: o.detail,
        role: typeof o.role === "string" ? o.role : undefined,
      };
    })
    .filter(Boolean) as ExecutionPlan["steps"];
  if (!steps.length) return undefined;
  const risk = p.risk === "high" || p.risk === "medium" ? p.risk : "low";
  return {
    title: p.title,
    steps,
    estimatedMinutes: Number(p.estimatedMinutes) || 10,
    filesLikelyTouched: Array.isArray(p.filesLikelyTouched)
      ? p.filesLikelyTouched.filter((x): x is string => typeof x === "string")
      : [],
    risk,
    notes: typeof p.notes === "string" ? p.notes : undefined,
  };
}

function parseWorkers(raw: unknown): WorkerSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const workers = raw
    .map((w, i) => {
      if (!w || typeof w !== "object") return null;
      const o = w as Record<string, unknown>;
      if (typeof o.role !== "string" || typeof o.instruction !== "string") {
        return null;
      }
      return {
        id: typeof o.id === "string" ? o.id : `w${i + 1}`,
        role: o.role,
        instruction: o.instruction,
        focus: Array.isArray(o.focus)
          ? o.focus.filter((x): x is string => typeof x === "string")
          : undefined,
      };
    })
    .filter(Boolean) as WorkerSpec[];
  return workers.length ? workers : undefined;
}

export function parseGptDecision(raw: unknown): GptDecision {
  if (!raw || typeof raw !== "object") {
    throw new Error("GPT decision must be an object");
  }
  const obj = raw as Record<string, unknown>;
  let status = obj.status;
  if (status === "ask") status = "needs_user";
  if (
    status !== "plan" &&
    status !== "continue" &&
    status !== "parallel" &&
    status !== "complete" &&
    status !== "needs_user" &&
    status !== "needs_approval"
  ) {
    throw new Error(`Invalid GPT status: ${String(status)}`);
  }

  const decision: GptDecision = { status };
  if (typeof obj.instruction === "string") decision.instruction = obj.instruction;
  if (typeof obj.merge_instruction === "string") {
    decision.merge_instruction = obj.merge_instruction;
  }
  if (typeof obj.question === "string") decision.question = obj.question;
  if (typeof obj.approval_reason === "string") {
    decision.approval_reason = obj.approval_reason;
  }
  if (typeof obj.summary === "string") decision.summary = obj.summary;
  if (typeof obj.notes === "string") decision.notes = obj.notes;
  if (Array.isArray(obj.next_improvements)) {
    decision.next_improvements = obj.next_improvements
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  decision.plan = parsePlan(obj.plan);
  decision.workers = parseWorkers(obj.workers);

  if (status === "plan" && !decision.plan) {
    throw new Error("GPT status=plan requires plan");
  }
  if (
    (status === "continue" || status === "needs_approval") &&
    !decision.instruction?.trim()
  ) {
    throw new Error(`GPT status=${status} requires instruction`);
  }
  if (status === "parallel" && !decision.workers?.length) {
    throw new Error("GPT status=parallel requires workers");
  }
  if (status === "needs_user" && !decision.question?.trim()) {
    throw new Error("GPT status=needs_user requires question");
  }
  if (status === "complete" && !decision.summary?.trim()) {
    throw new Error("GPT status=complete requires summary");
  }
  if (status === "complete" && !decision.next_improvements) {
    decision.next_improvements = [];
  }
  if (status === "needs_approval" && !decision.approval_reason?.trim()) {
    decision.approval_reason = "GPT requested approval for a sensitive action";
  }

  return decision;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class GptClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  constructor(options: GptClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  resetConversation(): void {
    this.messages = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  async planTurn(input: PlanTurnInput): Promise<GptPlanResult> {
    const userParts = [
      `Relay round: ${input.round} / ${input.maxRounds}`,
      input.requirePlan && !input.planAlreadyApproved
        ? "Planning mode: return status=plan first. Do not edit yet."
        : "Plan already approved (or planning disabled).",
      "",
      "Session memory:",
      formatMemoryForPrompt(input.memory),
    ];
    if (input.longMemoryContext) {
      userParts.push("", input.longMemoryContext);
    }
    if (input.gitContext) {
      userParts.push("", "Current git review (authoritative):", input.gitContext);
    }
    if (input.verifyContext) {
      userParts.push("", "Automatic verification:", input.verifyContext);
    }
    if (input.workerContext) {
      userParts.push("", "Parallel worker results:", input.workerContext);
    }
    if (input.lastCursorResult) {
      userParts.push("", "Latest Cursor Agent result:", input.lastCursorResult);
    }
    if (input.userReply) {
      userParts.push("", "Human reply:", input.userReply);
    }
    userParts.push(
      "",
      "Decide the next orchestrator action. Return JSON only.",
    );

    return this.chatJson(userParts.join("\n"), input.onDelta);
  }

  async supervise(input: {
    task: string;
    activity: string;
    currentInstruction: string;
    styleNotes?: string;
  }): Promise<SuperviseDecision> {
    const prompt = [
      "You are supervising a Cursor agent in real time.",
      `Task: ${input.task}`,
      `Current instruction: ${input.currentInstruction}`,
      `Live activity: ${input.activity}`,
      input.styleNotes ? `Style: ${input.styleNotes}` : "",
      "",
      'Return JSON: {"decision":"allow"|"redirect"|"stop","reason":"...","redirectInstruction":"optional"}',
      "Use redirect if the agent is about to make a mistake; stop only for dangerous actions.",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await this.ephemeralJson(prompt);
    const obj = result as Record<string, unknown>;
    const decision =
      obj.decision === "redirect" || obj.decision === "stop"
        ? obj.decision
        : "allow";
    return {
      decision,
      reason: typeof obj.reason === "string" ? obj.reason : "no reason",
      redirectInstruction:
        typeof obj.redirectInstruction === "string"
          ? obj.redirectInstruction
          : undefined,
    };
  }

  async analyzeGit(input: {
    statusText: string;
    diffStat: string;
    diffPatch: string;
    heuristic: GitIntelligence;
  }): Promise<GitIntelligence> {
    const prompt = [
      "Summarize this git change for a developer dashboard.",
      `Heuristic theme: ${input.heuristic.theme}`,
      "status:",
      input.statusText || "(clean)",
      "diff --stat:",
      input.diffStat || "(none)",
      "diff:",
      input.diffPatch.slice(0, 12000) || "(empty)",
      "",
      'Return JSON: {"theme":"...","bullets":["+ ...","~ ...","- ..."],"risk":"low|medium|high","breakingChanges":"...","migration":"Yes/No/..."}',
    ].join("\n");
    const raw = (await this.ephemeralJson(prompt)) as Record<string, unknown>;
    return {
      theme: typeof raw.theme === "string" ? raw.theme : input.heuristic.theme,
      bullets: Array.isArray(raw.bullets)
        ? raw.bullets.filter((x): x is string => typeof x === "string")
        : input.heuristic.bullets,
      risk:
        raw.risk === "high" || raw.risk === "medium" || raw.risk === "low"
          ? raw.risk
          : input.heuristic.risk,
      breakingChanges:
        typeof raw.breakingChanges === "string"
          ? raw.breakingChanges
          : input.heuristic.breakingChanges,
      migration:
        typeof raw.migration === "string"
          ? raw.migration
          : input.heuristic.migration,
    };
  }

  async verifyOpinion(input: {
    task: string;
    cursorSummary: string;
    verifyReport: string;
  }): Promise<{ accepts: boolean; notes: string }> {
    const prompt = [
      "Cursor claims the work is done. Automatic verification follows.",
      `Task: ${input.task}`,
      `Cursor summary:\n${input.cursorSummary.slice(0, 3000)}`,
      `Verification:\n${input.verifyReport.slice(0, 6000)}`,
      "",
      'Return JSON: {"accepts":true|false,"notes":"..."}',
      "accepts=true only if verification supports the claim.",
    ].join("\n");
    const raw = (await this.ephemeralJson(prompt)) as Record<string, unknown>;
    return {
      accepts: Boolean(raw.accepts),
      notes: typeof raw.notes === "string" ? raw.notes : "",
    };
  }

  private async chatJson(
    userContent: string,
    onDelta?: (chunk: string) => void,
  ): Promise<GptPlanResult> {
    this.messages.push({ role: "user", content: userContent });
    if (this.messages.length > 24) {
      this.messages = [this.messages[0], ...this.messages.slice(-22)];
    }

    const response = await this.fetchImpl(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          stream: true,
          stream_options: { include_usage: true },
          response_format: { type: "json_object" },
          messages: this.messages,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      this.messages.pop();
      throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 500)}`);
    }

    const { content, usage } = await this.readStreamingCompletion(
      response,
      onDelta,
    );
    if (!content) {
      this.messages.pop();
      throw new Error("OpenAI API returned empty content");
    }
    this.messages.push({ role: "assistant", content });
    return {
      decision: parseGptDecision(extractJsonObject(content)),
      usage,
      estimatedUsd: estimateGptUsd(this.model, usage),
      rawContent: content,
    };
  }

  private async ephemeralJson(prompt: string): Promise<unknown> {
    const response = await this.fetchImpl(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "Return only valid JSON for the requested schema.",
            },
            { role: "user", content: prompt },
          ],
        }),
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 300)}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty OpenAI content");
    return extractJsonObject(content);
  }

  private async readStreamingCompletion(
    response: Response,
    onDelta?: (chunk: string) => void,
  ): Promise<{ content: string; usage: TokenUsage }> {
    if (!response.body) {
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      return {
        content: payload.choices?.[0]?.message?.content ?? "",
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
          totalTokens: payload.usage?.total_tokens ?? 0,
        },
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            onDelta?.(delta);
          }
          if (json.usage) {
            usage = {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
              totalTokens: json.usage.total_tokens ?? 0,
            };
          }
        } catch {
          // ignore
        }
      }
    }

    if (!usage.totalTokens && content) {
      const approx = Math.ceil(content.length / 4);
      usage = {
        promptTokens: 0,
        completionTokens: approx,
        totalTokens: approx,
      };
    }
    return { content, usage };
  }
}
