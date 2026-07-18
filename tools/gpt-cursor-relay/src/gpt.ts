import { estimateGptUsd } from "./cost.js";
import { formatMemoryForPrompt } from "./memory.js";
import type {
  GptDecision,
  GptPlanResult,
  SessionMemory,
  TokenUsage,
} from "./types.js";

const SYSTEM_PROMPT = `You are the planner half of a local GPT ↔ Cursor autonomous relay.

You maintain a persistent conversation. The relay streams your decisions and Cursor's live output.
You do NOT edit files yourself. You issue clear instructions for Cursor Agent CLI.

Return ONLY valid JSON with this shape:
{
  "status": "continue" | "complete" | "needs_user" | "needs_approval",
  "instruction": "string — required for continue / needs_approval",
  "question": "string — required for needs_user",
  "approval_reason": "string — required for needs_approval",
  "summary": "string — required for complete",
  "notes": "string — optional short live status note",
  "next_improvements": ["string"] // required when status=complete; short follow-ups
}

Rules:
- status=continue: one concrete next Cursor step. The relay auto-continues — never ask the user to press Continue.
- status=complete: task done; include summary + next_improvements (even if empty array).
- status=needs_user: only when a human decision is truly required.
- status=needs_approval: next step would push, deploy, delete, or change secrets.
- Review the provided git diff/status carefully — trust the patch over Cursor's prose.
- Prefer verification (tests) before complete.
- Use session memory; do not re-ask for context already known.
- Keep instructions scoped to the project folder.
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
  lastCursorResult?: string;
  userReply?: string;
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

export function parseGptDecision(raw: unknown): GptDecision {
  if (!raw || typeof raw !== "object") {
    throw new Error("GPT decision must be an object");
  }
  const obj = raw as Record<string, unknown>;
  let status = obj.status;
  if (status === "ask") status = "needs_user";
  if (
    status !== "continue" &&
    status !== "complete" &&
    status !== "needs_user" &&
    status !== "needs_approval"
  ) {
    throw new Error(`Invalid GPT status: ${String(status)}`);
  }

  const decision: GptDecision = { status };
  if (typeof obj.instruction === "string") decision.instruction = obj.instruction;
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

  if (
    (status === "continue" || status === "needs_approval") &&
    !decision.instruction?.trim()
  ) {
    throw new Error(`GPT status=${status} requires instruction`);
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
  /** Persistent multi-turn conversation with GPT */
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
      "",
      "Session memory:",
      formatMemoryForPrompt(input.memory),
    ];

    if (input.gitContext) {
      userParts.push("", "Current git review (authoritative):", input.gitContext);
    }
    if (input.lastCursorResult) {
      userParts.push("", "Latest Cursor Agent result:", input.lastCursorResult);
    }
    if (input.userReply) {
      userParts.push("", "Human reply:", input.userReply);
    }

    userParts.push(
      "",
      "Decide the next autonomous action. Return JSON only. Do not ask the user to press Continue.",
    );

    const userContent = userParts.join("\n");
    this.messages.push({ role: "user", content: userContent });

    // Bound conversation growth while keeping system + recent turns.
    if (this.messages.length > 24) {
      this.messages = [
        this.messages[0],
        ...this.messages.slice(-22),
      ];
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
      // Roll back the user message on hard failure so retries can re-add it.
      this.messages.pop();
      throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 500)}`);
    }

    const { content, usage } = await this.readStreamingCompletion(
      response,
      input.onDelta,
    );

    if (!content) {
      this.messages.pop();
      throw new Error("OpenAI API returned empty content");
    }

    this.messages.push({ role: "assistant", content });
    const decision = parseGptDecision(extractJsonObject(content));
    const estimatedUsd = estimateGptUsd(this.model, usage);

    return {
      decision,
      usage,
      estimatedUsd,
      rawContent: content,
    };
  }

  private async readStreamingCompletion(
    response: Response,
    onDelta?: (chunk: string) => void,
  ): Promise<{ content: string; usage: TokenUsage }> {
    if (!response.body) {
      // Non-streaming fallback (tests / odd runtimes)
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
          // ignore partial JSON lines
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
