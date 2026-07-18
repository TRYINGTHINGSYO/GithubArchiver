import { spawn } from "node:child_process";
import { estimateTokensFromText } from "./cost.js";
import type { CursorRunResult } from "./types.js";

export interface CursorRunnerOptions {
  agentBin: string;
  apiKey?: string;
  /** Injected for tests */
  spawnImpl?: typeof spawn;
}

export interface CursorActivityEvent {
  kind: "text" | "tool" | "status" | "result";
  text: string;
}

export interface RunCursorInput {
  projectPath: string;
  instruction: string;
  signal?: AbortSignal;
  /** Soft timeout; process is killed when exceeded (default 30 minutes) */
  timeoutMs?: number;
  /** Resume a persistent Cursor chat when available */
  chatId?: string | null;
  attempt?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onActivity?: (event: CursorActivityEvent) => void;
}

function summarizeStreamLine(line: string): CursorActivityEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed) as {
      type?: string;
      subtype?: string;
      message?: { content?: Array<{ text?: string }> };
      tool_call?: Record<string, { args?: { path?: string; command?: string } }>;
      result?: string;
      duration_ms?: number;
      session_id?: string;
    };

    if (json.type === "assistant") {
      const text = json.message?.content?.[0]?.text;
      if (text?.trim()) return { kind: "text", text: text.trim() };
      return null;
    }

    if (json.type === "tool_call" && json.subtype === "started") {
      const tool = json.tool_call ?? {};
      if (tool.writeToolCall?.args?.path) {
        return { kind: "tool", text: `Editing ${tool.writeToolCall.args.path}` };
      }
      if (tool.readToolCall?.args?.path) {
        return { kind: "tool", text: `Reading ${tool.readToolCall.args.path}` };
      }
      if (tool.shellToolCall?.args?.command) {
        return {
          kind: "tool",
          text: `Running ${tool.shellToolCall.args.command.slice(0, 120)}`,
        };
      }
      return { kind: "tool", text: "Tool call started" };
    }

    if (json.type === "result") {
      return {
        kind: "result",
        text: `Completed${json.duration_ms != null ? ` in ${json.duration_ms}ms` : ""}`,
      };
    }

    if (json.type === "system" && json.subtype === "init") {
      return { kind: "status", text: "Cursor session started" };
    }
  } catch {
    // plain text line
    return { kind: "text", text: trimmed.slice(0, 500) };
  }
  return null;
}

function extractChatId(stdout: string, stderr: string): string | undefined {
  const blob = `${stdout}\n${stderr}`;
  for (const line of blob.split("\n")) {
    try {
      const json = JSON.parse(line.trim()) as {
        session_id?: string;
        chatId?: string;
        id?: string;
      };
      if (json.session_id) return json.session_id;
      if (json.chatId) return json.chatId;
    } catch {
      // continue
    }
  }
  const match = blob.match(/"session_id"\s*:\s*"([^"]+)"/);
  return match?.[1];
}

export class CursorRunner {
  private readonly agentBin: string;
  private readonly apiKey?: string;
  private readonly spawnImpl: typeof spawn;

  constructor(options: CursorRunnerOptions) {
    this.agentBin = options.agentBin;
    this.apiKey = options.apiKey;
    this.spawnImpl = options.spawnImpl ?? spawn;
  }

  async run(input: RunCursorInput): Promise<CursorRunResult> {
    const timeoutMs = input.timeoutMs ?? 30 * 60 * 1000;
    const attempt = input.attempt ?? 1;
    const started = Date.now();
    const args = [
      "-p",
      "--force",
      "--trust",
      "--workspace",
      input.projectPath,
      "--output-format",
      "stream-json",
      "--stream-partial-output",
    ];
    if (input.chatId) {
      args.push("--resume", input.chatId);
    }
    args.push(input.instruction);

    const env = { ...process.env };
    if (this.apiKey) {
      env.CURSOR_API_KEY = this.apiKey;
    }

    return await new Promise<CursorRunResult>((resolve, reject) => {
      if (input.signal?.aborted) {
        reject(new Error("Cursor run aborted before start"));
        return;
      }

      let child;
      try {
        child = this.spawnImpl(this.agentBin, args, {
          cwd: input.projectPath,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        resolve({
          ok: false,
          exitCode: null,
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
          timedOut: false,
          durationMs: Date.now() - started,
          estimatedTokens: 0,
          crashed: true,
          attempt,
        });
        return;
      }

      let stdout = "";
      let stderr = "";
      let lineBuf = "";
      let settled = false;
      let timedOut = false;
      let crashed = false;

      const finish = (result: CursorRunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const onAbort = () => {
        timedOut = false;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 2000).unref?.();
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 2000).unref?.();
      }, timeoutMs);

      input.signal?.addEventListener("abort", onAbort, { once: true });

      const handleChunk = (chunk: string, isErr: boolean) => {
        if (isErr) {
          stderr += chunk;
          input.onStderr?.(chunk);
        } else {
          stdout += chunk;
          input.onStdout?.(chunk);
        }
        lineBuf += chunk;
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";
        for (const line of lines) {
          const activity = summarizeStreamLine(line);
          if (activity) input.onActivity?.(activity);
        }
      };

      child.stdout?.on("data", (buf: Buffer) => handleChunk(buf.toString("utf8"), false));
      child.stderr?.on("data", (buf: Buffer) => handleChunk(buf.toString("utf8"), true));

      child.on("error", (err) => {
        crashed = true;
        if (settled) return;
        finish({
          ok: false,
          exitCode: null,
          stdout: stdout.trim(),
          stderr: `${stderr}\n${err.message}`.trim(),
          timedOut: false,
          durationMs: Date.now() - started,
          estimatedTokens: estimateTokensFromText(stdout + stderr),
          crashed: true,
          attempt,
        });
      });

      child.on("close", (code, signal) => {
        if (lineBuf.trim()) {
          const activity = summarizeStreamLine(lineBuf);
          if (activity) input.onActivity?.(activity);
        }
        const aborted = Boolean(input.signal?.aborted);
        if (signal && !aborted && !timedOut) crashed = true;
        const chatId = extractChatId(stdout, stderr);
        const textOut = stripStreamJsonToText(stdout);
        finish({
          ok: !timedOut && !aborted && !crashed && code === 0,
          exitCode: code,
          stdout: textOut || stdout.trim(),
          stderr: stderr.trim(),
          timedOut,
          durationMs: Date.now() - started,
          chatId,
          estimatedTokens: estimateTokensFromText(stdout + stderr),
          crashed,
          attempt,
        });
      });
    });
  }
}

/** Prefer human-readable assistant/result text over raw NDJSON. */
function stripStreamJsonToText(stdout: string): string {
  const texts: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      if (trimmed) texts.push(trimmed);
      continue;
    }
    try {
      const json = JSON.parse(trimmed) as {
        type?: string;
        message?: { content?: Array<{ text?: string }> };
        result?: string;
      };
      if (json.type === "assistant") {
        const t = json.message?.content?.[0]?.text;
        if (t) texts.push(t);
      } else if (json.type === "result" && typeof json.result === "string") {
        texts.push(json.result);
      }
    } catch {
      texts.push(trimmed);
    }
  }
  return texts.join("\n").trim();
}
