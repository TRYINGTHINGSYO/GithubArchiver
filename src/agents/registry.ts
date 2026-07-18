import { adaptCursorRunner, type CodingAgent } from "../agent.js";
import type { CursorRunner } from "../cursor.js";
import { which } from "../cli/which.js";

export interface AgentDescriptor {
  id: string;
  displayName: string;
  /** Shell binary to detect */
  binary?: string;
  available: boolean;
  notes: string;
  create?: (opts: { apiKey?: string }) => CodingAgent;
}

/** Cursor adapter factory */
export function createCursorAgent(runner: CursorRunner): CodingAgent {
  return adaptCursorRunner(runner);
}

/**
 * Stub / detection-only adapters for future multi-model support.
 * They become real implementations without changing the orchestrator core.
 */
export async function listAgentDescriptors(
  cursorRunner?: CursorRunner,
): Promise<AgentDescriptor[]> {
  const cursorBin = await which("agent");
  const claudeBin = await which("claude");
  const codexBin = (await which("codex")) || (await which("openai"));
  const geminiBin = await which("gemini");
  const aiderBin = await which("aider");

  return [
    {
      id: "cursor",
      displayName: "Cursor Agent CLI",
      binary: "agent",
      available: Boolean(cursorBin),
      notes: cursorBin
        ? `Found at ${cursorBin}`
        : "Install: https://cursor.com/docs/cli/headless",
      create: cursorRunner
        ? () => createCursorAgent(cursorRunner)
        : undefined,
    },
    {
      id: "claude-code",
      displayName: "Claude Code",
      binary: "claude",
      available: Boolean(claudeBin),
      notes: claudeBin
        ? `Detected at ${claudeBin} (adapter stub — wire startTask next)`
        : "Not installed (claude CLI)",
    },
    {
      id: "openai-codex",
      displayName: "OpenAI Codex CLI",
      binary: "codex",
      available: Boolean(codexBin),
      notes: codexBin
        ? `Detected at ${codexBin} (adapter stub)`
        : "Not installed (codex / openai CLI)",
    },
    {
      id: "gemini",
      displayName: "Gemini CLI",
      binary: "gemini",
      available: Boolean(geminiBin),
      notes: geminiBin
        ? `Detected at ${geminiBin} (adapter stub)`
        : "Not installed",
    },
    {
      id: "aider",
      displayName: "Aider (local)",
      binary: "aider",
      available: Boolean(aiderBin),
      notes: aiderBin
        ? `Detected at ${aiderBin} (adapter stub)`
        : "Not installed",
    },
  ];
}

export async function resolveDefaultAgentId(): Promise<string> {
  const list = await listAgentDescriptors();
  const cursor = list.find((a) => a.id === "cursor" && a.available);
  if (cursor) return "cursor";
  const any = list.find((a) => a.available);
  return any?.id ?? "cursor";
}
