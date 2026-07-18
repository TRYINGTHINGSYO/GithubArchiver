import { spawn } from "node:child_process";
import type { CursorRunResult } from "./types.js";

export interface CursorRunnerOptions {
  agentBin: string;
  apiKey?: string;
  /** Injected for tests */
  spawnImpl?: typeof spawn;
}

export interface RunCursorInput {
  projectPath: string;
  instruction: string;
  signal?: AbortSignal;
  /** Soft timeout; process is killed when exceeded (default 30 minutes) */
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
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
    const started = Date.now();
    const args = [
      "-p",
      "--force",
      "--trust",
      "--workspace",
      input.projectPath,
      "--output-format",
      "text",
      input.instruction,
    ];

    const env = { ...process.env };
    if (this.apiKey) {
      env.CURSOR_API_KEY = this.apiKey;
    }

    return await new Promise<CursorRunResult>((resolve, reject) => {
      if (input.signal?.aborted) {
        reject(new Error("Cursor run aborted before start"));
        return;
      }

      const child = this.spawnImpl(this.agentBin, args, {
        cwd: input.projectPath,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

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

      child.stdout?.on("data", (buf: Buffer) => {
        const chunk = buf.toString("utf8");
        stdout += chunk;
        input.onStdout?.(chunk);
      });
      child.stderr?.on("data", (buf: Buffer) => {
        const chunk = buf.toString("utf8");
        stderr += chunk;
        input.onStderr?.(chunk);
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
        reject(err);
      });

      child.on("close", (code) => {
        const aborted = Boolean(input.signal?.aborted);
        finish({
          ok: !timedOut && !aborted && code === 0,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut,
          durationMs: Date.now() - started,
        });
      });
    });
  }
}
