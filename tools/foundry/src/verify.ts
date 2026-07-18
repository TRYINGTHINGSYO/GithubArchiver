import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ApprovalPolicy } from "./config.js";
import { DEFAULT_APPROVAL } from "./config.js";
import type { OrchestratorPlugin } from "./plugins/types.js";
import type { VerifyResult } from "./types.js";

export interface VerifyOptions {
  projectPath: string;
  browserVerify?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  plugins?: OrchestratorPlugin[];
  approval?: ApprovalPolicy;
}

async function readPkg(projectPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path.join(projectPath, "package.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function runCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = 10 * 60 * 1000,
): Promise<{ ok: boolean; exitCode: number | null; output: string; durationMs: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({
        ok: false,
        exitCode: null,
        output: "aborted",
        durationMs: 0,
      });
      return;
    }
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const finish = (ok: boolean, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        ok,
        exitCode,
        output: output.trim().slice(0, 20_000),
        durationMs: Date.now() - started,
      });
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(false, null);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(false, null);
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (b: Buffer) => {
      output += b.toString("utf8");
    });
    child.stderr?.on("data", (b: Buffer) => {
      output += b.toString("utf8");
    });
    child.on("error", (err) => {
      output += `\n${err.message}`;
      finish(false, null);
    });
    child.on("close", (code) => finish(code === 0, code));
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectVerifyCommands(
  projectPath: string,
): Promise<Array<{ name: string; command: string }>> {
  const pkg = await readPkg(projectPath);
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const cmds: Array<{ name: string; command: string }> = [];

  if (scripts.test) cmds.push({ name: "test", command: "npm test" });
  if (scripts.build) cmds.push({ name: "build", command: "npm run build" });
  if (scripts.lint) cmds.push({ name: "lint", command: "npm run lint" });
  else if (scripts["check"]) cmds.push({ name: "lint", command: "npm run check" });
  else if (await fileExists(path.join(projectPath, "eslint.config.js")) ||
    await fileExists(path.join(projectPath, ".eslintrc.cjs"))) {
    cmds.push({ name: "lint", command: "npx eslint . --max-warnings=0" });
  }

  // Always include typecheck if present
  if (scripts.typecheck) {
    cmds.push({ name: "typecheck", command: "npm run typecheck" });
  }

  return cmds.slice(0, 4);
}

async function browserSmoke(
  projectPath: string,
  signal?: AbortSignal,
): Promise<{ attempted: boolean; ok: boolean; report: string }> {
  const pkg = await readPkg(projectPath);
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  const deps = {
    ...(pkg?.dependencies as object),
    ...(pkg?.devDependencies as object),
  };
  const isWeb =
    "svelte" in deps ||
    "@sveltejs/kit" in deps ||
    "vite" in deps ||
    "next" in deps ||
    "react" in deps;

  if (!isWeb) {
    return {
      attempted: false,
      ok: true,
      report: "Browser verify skipped (not detected as a web app)",
    };
  }

  // Prefer a cheap HTTP smoke if a preview/dev URL is already up.
  const urls = ["http://127.0.0.1:5173", "http://127.0.0.1:3000", "http://127.0.0.1:4173"];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.any?.(
          [signal, AbortSignal.timeout(2500)].filter(Boolean) as AbortSignal[],
        ) ?? AbortSignal.timeout(2500),
      });
      const text = await res.text();
      const hasError =
        /<script[^>]*>[\s\S]*error[\s\S]*<\/script>/i.test(text) === false
          ? false
          : false;
      const jsErrorHints = /Unhandled|TypeError|ReferenceError/i.test(text);
      return {
        attempted: true,
        ok: res.ok && !jsErrorHints && !hasError,
        report: `HTTP smoke ${url} → ${res.status} (${text.length} bytes)` +
          (scripts.dev ? `\nTip: keep \`npm run dev\` running for richer browser checks.` : ""),
      };
    } catch {
      // try next
    }
  }

  return {
    attempted: true,
    ok: false,
    report:
      "Browser verify: no local server responded on :5173/:3000/:4173. " +
      "Start the app (npm run dev) for HTTP smoke checks, or add Playwright later for full login flows.",
  };
}

export async function runVerification(
  options: VerifyOptions,
): Promise<VerifyResult> {
  const base = await detectVerifyCommands(options.projectPath);
  const pluginCmds: Array<{ name: string; command: string }> = [];
  const pluginNotes: string[] = [];
  const ctx = {
    projectPath: options.projectPath,
    approval: options.approval ?? DEFAULT_APPROVAL,
    signal: options.signal,
  };

  for (const plugin of options.plugins ?? []) {
    if (plugin.verifyCommands) {
      try {
        pluginCmds.push(...(await plugin.verifyCommands(ctx)));
      } catch (err) {
        pluginNotes.push(
          `plugin ${plugin.id} verifyCommands failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (plugin.verify) {
      try {
        const custom = await plugin.verify(ctx);
        if (custom) {
          pluginNotes.push(`[${plugin.id}] ${custom.summary}`);
        }
      } catch (err) {
        pluginNotes.push(
          `plugin ${plugin.id} verify failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Deduplicate by command string; keep base first, then plugins (cap at 8)
  const seen = new Set<string>();
  const commands = [...base, ...pluginCmds].filter((c) => {
    if (seen.has(c.command)) return false;
    seen.add(c.command);
    return true;
  }).slice(0, 8);

  const results: VerifyResult["commands"] = [];

  for (const cmd of commands) {
    const result = await runCommand(
      cmd.command,
      options.projectPath,
      options.signal,
      options.timeoutMs,
    );
    results.push({
      name: cmd.name,
      command: cmd.command,
      ok: result.ok,
      exitCode: result.exitCode,
      output: result.output,
      durationMs: result.durationMs,
    });
  }

  let coverageNote: string | undefined;
  const testOut = results.find((r) => r.name === "test")?.output ?? "";
  const cov = testOut.match(/coverage[:\s]+(\d+(?:\.\d+)?%)/i);
  if (cov) coverageNote = `Coverage ${cov[1]}`;

  let browser: VerifyResult["browser"];
  if (options.browserVerify) {
    browser = await browserSmoke(options.projectPath, options.signal);
  }

  const ok =
    results.every((r) => r.ok) && (browser ? browser.ok || !browser.attempted : true);

  const summary = [
    ...results.map(
      (r) =>
        `${r.ok ? "✓" : "✗"} ${r.name} (${r.command}) exit=${r.exitCode} ${r.durationMs}ms`,
    ),
    coverageNote ? `Coverage: ${coverageNote}` : null,
    browser
      ? `${browser.ok ? "✓" : "✗"} browser: ${browser.report}`
      : null,
    ...pluginNotes,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    ok,
    commands: results,
    summary: summary || "No verify commands detected",
    coverageNote,
    browser,
  };
}

export function formatVerifyForPrompt(result: VerifyResult): string {
  const parts = [
    `Verification ok=${result.ok}`,
    result.summary,
    ...result.commands.map(
      (c) =>
        `\n--- ${c.name} ---\n${c.output.slice(0, 4000) || "(no output)"}`,
    ),
  ];
  if (result.browser) {
    parts.push(`\n--- browser ---\n${result.browser.report}`);
  }
  return parts.join("\n");
}
