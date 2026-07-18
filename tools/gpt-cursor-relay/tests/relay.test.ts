import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RelaySession } from "../src/relay.js";
import { defaultStyle } from "../src/persist.js";
import type { GitSnapshot, GptDecision, GptPlanResult } from "../src/types.js";

function gitSnap(files: GitSnapshot["files"] = [], hash = "h1"): GitSnapshot {
  return {
    statusText: files.map((f) => `${f.status} ${f.path}`).join("\n"),
    diffStat: files.length ? `${files.length} files changed` : "",
    diffPatch: files.length
      ? `diff --git a/${files[0].path} b/${files[0].path}\n+changed`
      : "",
    files,
    diffFiles: files.map((f) => ({
      path: f.path,
      status: f.status,
      kind: f.kind,
      additions: 1,
      deletions: 0,
      lines: [
        { type: "meta", text: `diff --git a/${f.path} b/${f.path}` },
        { type: "add", text: "+changed" },
      ],
    })),
    additions: files.length,
    deletions: 0,
    diffHash: files.length ? hash : "",
  };
}

function mockGpt(decisions: GptDecision[]) {
  const queue = [...decisions];
  return {
    resetConversation: vi.fn(),
    planTurn: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error("No more GPT decisions");
      const result: GptPlanResult = {
        decision: next,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        estimatedUsd: 0.001,
        rawContent: JSON.stringify(next),
      };
      return result;
    }),
    analyzeGit: vi.fn(async ({ heuristic }) => heuristic),
    verifyOpinion: vi.fn(async () => ({ accepts: true, notes: "looks good" })),
    supervise: vi.fn(async () => ({ decision: "allow", reason: "ok" })),
  };
}

function mockCursor(
  results: Array<{
    ok?: boolean;
    stdout?: string;
    crashed?: boolean;
    chatId?: string;
  }> = [],
) {
  const queue = [...results];
  return {
    run: vi.fn(async () => {
      const next = queue.shift() ?? { ok: true, stdout: "done" };
      return {
        ok: next.ok ?? true,
        exitCode: next.ok === false ? 1 : 0,
        stdout: next.stdout ?? "done",
        stderr: "",
        timedOut: false,
        durationMs: 12,
        chatId: next.chatId,
        estimatedTokens: 120,
        crashed: next.crashed ?? false,
        attempt: 1,
      };
    }),
  };
}

function baseDeps(gpt: ReturnType<typeof mockGpt>, cursor: ReturnType<typeof mockCursor>) {
  return {
    gpt: gpt as never,
    cursor: cursor as never,
    collectGitSnapshot: async () =>
      cursor.run.mock.calls.length > 0
        ? gitSnap([{ path: "note.txt", status: "M", kind: "modified" }], "diff-a")
        : gitSnap(),
    createCheckpoint: async () => ({
      id: "cp1",
      createdAt: new Date().toISOString(),
      projectPath: "/tmp",
      headSha: "abc12345deadbeef",
      stashRef: null,
      label: "test",
    }),
    rollbackToCheckpoint: async () => ({
      ok: true,
      message: "Rolled back to abc12345",
    }),
    loadProjectMemory: async () => ({
      projectPath: "/tmp",
      projectName: "tmp",
      sessions: [],
      style: defaultStyle(),
      facts: ["Built analytics last month"],
    }),
    rememberSessionEnd: async () => ({
      projectPath: "/tmp",
      projectName: "tmp",
      sessions: [],
      style: defaultStyle(),
      facts: [],
    }),
    runVerification: async () => ({
      ok: true,
      commands: [
        {
          name: "test",
          command: "npm test",
          ok: true,
          exitCode: 0,
          output: "1 passed",
          durationMs: 10,
        },
      ],
      summary: "✓ test (npm test) exit=0 10ms",
    }),
    runParallelWorkers: async () => [],
  };
}

describe("RelaySession orchestrator", () => {
  it("plans optional, runs Cursor, verifies, completes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-"));
    await writeFile(path.join(dir, "note.txt"), "hi\n", "utf8");

    const gpt = mockGpt([
      {
        status: "continue",
        instruction: "Edit note.txt and explain what you changed",
        notes: "first edit",
      },
      {
        status: "complete",
        summary: "Fixed the note and verified locally.",
        next_improvements: ["Add a unit test for note formatting"],
      },
    ]);
    const cursor = mockCursor([
      { stdout: "Updated note.txt\n1 passed", chatId: "chat-1" },
    ]);
    const session = new RelaySession(baseDeps(gpt, cursor));

    await session.start({
      projectPath: dir,
      task: "Update the note",
      maxRounds: 5,
      openaiApiKey: "test",
      openaiModel: "gpt-test",
      cursorAgentBin: "agent",
      requirePlanApproval: false,
      supervisorEnabled: false,
      autoVerify: true,
    });

    const final = session.snapshot();
    expect(final.status).toBe("completed");
    expect(final.summary).toMatch(/Fixed the note/);
    expect(final.nextImprovements).toContain(
      "Add a unit test for note formatting",
    );
    expect(final.verification?.ok).toBe(true);
    expect(final.canRollback).toBe(true);
    expect(final.memory.longMemoryFacts[0]).toMatch(/analytics/i);
    expect(gpt.planTurn).toHaveBeenCalled();
    expect(cursor.run).toHaveBeenCalledTimes(1);
  });

  it("waits for plan approval before editing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-"));
    const gpt = mockGpt([
      {
        status: "plan",
        plan: {
          title: "Build auth",
          steps: [
            { id: "1", title: "API", detail: "JWT", role: "backend" },
          ],
          estimatedMinutes: 12,
          filesLikelyTouched: ["src/auth.ts"],
          risk: "medium",
        },
      },
      {
        status: "complete",
        summary: "Stopped after plan-only test",
        next_improvements: [],
      },
    ]);
    const cursor = mockCursor();
    const session = new RelaySession(baseDeps(gpt, cursor));

    const started = session.start({
      projectPath: dir,
      task: "Build authentication",
      maxRounds: 4,
      openaiApiKey: "test",
      openaiModel: "gpt-test",
      cursorAgentBin: "agent",
      requirePlanApproval: true,
      supervisorEnabled: false,
      autoVerify: false,
    });

    for (let i = 0; i < 50; i++) {
      if (session.snapshot().status === "awaiting_plan") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(session.snapshot().status).toBe("awaiting_plan");
    expect(session.snapshot().pendingPlan?.title).toBe("Build auth");
    expect(cursor.run).not.toHaveBeenCalled();

    session.resolvePlan(true);
    await started;

    expect(session.snapshot().status).toBe("completed");
    expect(cursor.run).not.toHaveBeenCalled();
  });

  it("supports rollback after completion", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-"));
    const gpt = mockGpt([
      {
        status: "complete",
        summary: "Nothing to do",
        next_improvements: [],
      },
    ]);
    const cursor = mockCursor();
    const rollback = vi.fn(async () => ({
      ok: true,
      message: "Rolled back to abc12345",
    }));
    const session = new RelaySession({
      ...baseDeps(gpt, cursor),
      rollbackToCheckpoint: rollback,
    });

    await session.start({
      projectPath: dir,
      task: "noop",
      maxRounds: 2,
      openaiApiKey: "test",
      openaiModel: "gpt-test",
      cursorAgentBin: "agent",
      requirePlanApproval: false,
      autoVerify: false,
      supervisorEnabled: false,
    });

    const result = await session.rollback();
    expect(result.ok).toBe(true);
    expect(rollback).toHaveBeenCalled();
  });

  it("pauses for approval on git push instructions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-"));
    const gpt = mockGpt([
      {
        status: "continue",
        instruction: "Commit if needed and git push origin HEAD",
      },
    ]);
    const cursor = mockCursor();
    const session = new RelaySession(baseDeps(gpt, cursor));

    const started = session.start({
      projectPath: dir,
      task: "Ship it",
      maxRounds: 3,
      openaiApiKey: "test",
      openaiModel: "gpt-test",
      cursorAgentBin: "agent",
      requirePlanApproval: false,
      autoVerify: false,
      supervisorEnabled: false,
    });

    for (let i = 0; i < 40; i++) {
      if (session.snapshot().status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(session.snapshot().status).toBe("awaiting_approval");
    session.resolveApproval(false);
    await started;
    expect(session.snapshot().status).toBe("stopped");
    expect(cursor.run).not.toHaveBeenCalled();
  });
});
