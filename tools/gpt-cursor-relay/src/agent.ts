/**
 * Coding-agent abstraction.
 * Cursor is today's implementation; tomorrow can be another agent without
 * rewriting the orchestrator.
 */

export type AgentEventKind = "text" | "tool" | "status" | "result" | "error";

export interface AgentEvent {
  kind: AgentEventKind;
  text: string;
  ts?: string;
  meta?: Record<string, unknown>;
}

export interface AgentTaskInput {
  projectPath: string;
  instruction: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Opaque resume token from a prior run (chat/session id) */
  resumeToken?: string | null;
  attempt?: number;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentTaskResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  resumeToken?: string;
  estimatedTokens: number;
  crashed: boolean;
  attempt: number;
  aborted?: boolean;
}

export interface CodingAgent {
  readonly id: string;
  readonly displayName: string;
  startTask(input: AgentTaskInput): Promise<AgentTaskResult>;
  cancel?(reason?: string): void;
}

/** Adapt legacy CursorRunner to CodingAgent. */
export function adaptCursorRunner(runner: {
  run: (input: {
    projectPath: string;
    instruction: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    chatId?: string | null;
    attempt?: number;
    onActivity?: (event: { kind: string; text: string }) => void;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  }) => Promise<{
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
  }>;
}): CodingAgent {
  return {
    id: "cursor",
    displayName: "Cursor Agent CLI",
    async startTask(input) {
      const result = await runner.run({
        projectPath: input.projectPath,
        instruction: input.instruction,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        chatId: input.resumeToken,
        attempt: input.attempt,
        onActivity: (event) => {
          input.onEvent?.({
            kind: event.kind as AgentEventKind,
            text: event.text,
            ts: new Date().toISOString(),
          });
        },
      });
      return {
        ok: result.ok,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        resumeToken: result.chatId,
        estimatedTokens: result.estimatedTokens,
        crashed: result.crashed,
        attempt: result.attempt,
        aborted: Boolean(input.signal?.aborted),
      };
    },
  };
}
