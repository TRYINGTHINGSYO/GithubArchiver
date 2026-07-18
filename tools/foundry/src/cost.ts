import type { CostBreakdown, TokenUsage } from "./types.js";

/** Rough USD / 1M tokens for common OpenAI chat models (prompt, completion). */
const MODEL_RATES: Record<string, { prompt: number; completion: number }> = {
  "gpt-4.1": { prompt: 2.0, completion: 8.0 },
  "gpt-4.1-mini": { prompt: 0.4, completion: 1.6 },
  "gpt-4o": { prompt: 2.5, completion: 10.0 },
  "gpt-4o-mini": { prompt: 0.15, completion: 0.6 },
  "gpt-5": { prompt: 1.25, completion: 10.0 },
  "o3-mini": { prompt: 1.1, completion: 4.4 },
};

const DEFAULT_RATE = { prompt: 2.0, completion: 8.0 };

export function estimateGptUsd(model: string, usage: TokenUsage): number {
  const key = Object.keys(MODEL_RATES).find((m) =>
    model.toLowerCase().startsWith(m),
  );
  const rate = (key ? MODEL_RATES[key] : undefined) ?? DEFAULT_RATE;
  const usd =
    (usage.promptTokens / 1_000_000) * rate.prompt +
    (usage.completionTokens / 1_000_000) * rate.completion;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Cursor CLI does not always expose billed USD; estimate tokens from text volume. */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function emptyCost(): CostBreakdown {
  return {
    gptUsd: 0,
    cursorTokens: 0,
    gptPromptTokens: 0,
    gptCompletionTokens: 0,
    rounds: [],
    totalUsd: 0,
  };
}

export function addRoundCost(
  cost: CostBreakdown,
  round: number,
  gptUsage: TokenUsage,
  gptUsd: number,
  cursorTokens: number,
): CostBreakdown {
  const next: CostBreakdown = {
    gptUsd: cost.gptUsd + gptUsd,
    cursorTokens: cost.cursorTokens + cursorTokens,
    gptPromptTokens: cost.gptPromptTokens + gptUsage.promptTokens,
    gptCompletionTokens: cost.gptCompletionTokens + gptUsage.completionTokens,
    rounds: [
      ...cost.rounds,
      {
        round,
        gptUsd,
        gptTokens: gptUsage.totalTokens,
        cursorTokens,
      },
    ],
    totalUsd: 0,
  };
  // Cursor USD unknown — total shows GPT cost only, tokens tracked separately.
  next.totalUsd = Math.round(next.gptUsd * 1_000_000) / 1_000_000;
  return next;
}

export function formatCostSummary(cost: CostBreakdown): string {
  const lines = cost.rounds.map(
    (r) =>
      `Round ${r.round}: GPT $${r.gptUsd.toFixed(4)} (${r.gptTokens} tok) · Cursor ~${r.cursorTokens} tok`,
  );
  lines.push(
    `Total: GPT $${cost.totalUsd.toFixed(4)} · Cursor ~${cost.cursorTokens} tok`,
  );
  return lines.join("\n");
}
