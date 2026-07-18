import type { GptDecision, LogEntry } from "./types.js";

const SYSTEM_PROMPT = `You are the planner half of a local GPT ↔ Cursor relay.

Your job is to drive Cursor Agent CLI toward completing the user's task.
You do NOT edit files yourself. You issue clear, self-contained instructions for Cursor.

Return ONLY valid JSON with this shape:
{
  "status": "continue" | "complete" | "ask" | "needs_approval",
  "instruction": "string — required for continue / needs_approval",
  "question": "string — required for ask",
  "approval_reason": "string — required for needs_approval",
  "summary": "string — required for complete",
  "notes": "string — optional short log note"
}

Rules:
- status=continue: give Cursor one concrete next step (or a small tightly scoped batch).
- status=complete: the task is done; put a final summary in "summary".
- status=ask: you need a human decision/clarification; put it in "question".
- status=needs_approval: the next Cursor step would push, deploy, delete, or change secrets.
  Put the exact Cursor instruction in "instruction" and why in "approval_reason".
- Prefer verification (tests / commands) before declaring complete.
- Do not ask Cursor to copy/paste between ChatGPT and Cursor windows — this relay handles that.
- Keep instructions actionable and scoped to the selected project folder.
- If Cursor reports failure, diagnose and issue a corrective instruction (or ask the human).
`;

export interface GptClientOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface PlanTurnInput {
  task: string;
  projectPath: string;
  round: number;
  maxRounds: number;
  recentLogs: LogEntry[];
  lastCursorResult?: string;
  userReply?: string;
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
  const status = obj.status;
  if (
    status !== "continue" &&
    status !== "complete" &&
    status !== "ask" &&
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

  if (
    (status === "continue" || status === "needs_approval") &&
    !decision.instruction?.trim()
  ) {
    throw new Error(`GPT status=${status} requires instruction`);
  }
  if (status === "ask" && !decision.question?.trim()) {
    throw new Error("GPT status=ask requires question");
  }
  if (status === "complete" && !decision.summary?.trim()) {
    throw new Error("GPT status=complete requires summary");
  }
  if (status === "needs_approval" && !decision.approval_reason?.trim()) {
    decision.approval_reason = "GPT requested approval for a sensitive action";
  }

  return decision;
}

export class GptClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GptClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async planTurn(input: PlanTurnInput): Promise<GptDecision> {
    const history = input.recentLogs
      .slice(-24)
      .map((entry) => {
        const round = entry.round != null ? ` round=${entry.round}` : "";
        return `[${entry.source}${round}] ${entry.text}`;
      })
      .join("\n");

    const userParts = [
      `Project folder: ${input.projectPath}`,
      `User task: ${input.task}`,
      `Relay round: ${input.round} / ${input.maxRounds}`,
      "",
      "Recent relay log:",
      history || "(empty — this is the first planning turn)",
    ];

    if (input.lastCursorResult) {
      userParts.push("", "Latest Cursor Agent result:", input.lastCursorResult);
    }
    if (input.userReply) {
      userParts.push("", "Human reply:", input.userReply);
    }

    userParts.push(
      "",
      "Decide the next relay action. Return JSON only.",
    );

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
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userParts.join("\n") },
          ],
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 500)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI API returned empty content");
    }

    return parseGptDecision(extractJsonObject(content));
  }
}
