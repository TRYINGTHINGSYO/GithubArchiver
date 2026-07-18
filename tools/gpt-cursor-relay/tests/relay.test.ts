import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RelaySession } from "../src/relay.js";
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

describe("RelaySession autonomous loop", () => {
  it("streams memory + git into complete with next improvements", async () => {
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

    let gitCalls = 0;
    const session = new RelaySession({
      gpt: gpt as never,
      cursor: cursor as never,
      collectGitSnapshot: async () => {
        gitCalls += 1;
        // After Cursor has run once, report a change
        if (cursor.run.mock.calls.length > 0) {
          return gitSnap(
            [{ path: "note.txt", status: "M", kind: "modified" }],
            "diff-a",
          );
        }
        return gitSnap();
      },
    });

    await session.start({
      projectPath: dir,
      task: "Update the note",
      maxRounds: 5,
      openaiApiKey: "test",
      openaiModel: "gpt-test",
      cursorAgentBin: "agent",
    });

    const final = session.snapshot();
    expect(final.status).toBe("completed");
    expect(final.summary).toMatch(/Fixed the note/);
    expect(final.nextImprovements).toContain(
      "Add a unit test for note formatting",
    );
    expect(final.memory.cursorChatId).toBe("chat-1");
    expect(final.memory.rounds.length).toBeGreaterThan(0);
    expect(final.cost.rounds.length).toBeGreaterThan(0);
    expect(gpt.planTurn).toHaveBeenCalledTimes(2);
    expect(cursor.run).toHaveBeenCalledTimes(1);
    expect(gitCalls).toBeGreaterThan(1);
    const firstCursorCall = (
      cursor.run.mock.calls as unknown as Array<[{ instruction: string }]>
    )[0]?.[0];
    expect(firstCursorCall?.instruction).toContain("Edit note.txt");
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
    const session = new RelaySession({
      gpt: gpt as never,
      cursor: cursor as never,
      collectGitSnapshot: async () => gitSnap(),
    });

    const started = session.start({
      projectPath: dir,
      task: "Ship it",
      maxRounds: 3,
      openaiApiKey: "test",
      openaiModel: "gpt-test",
      cursorAgentBin: "agent",
    });

    for (let i = 0; i < 40; i++) {
      if (session.snapshot().status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(session.snapshot().status).toBe("awaiting_approval");
    expect(session.snapshot().pendingApproval?.categories).toContain("push");
    expect(cursor.run).not.toHaveBeenCalled();

    session.resolveApproval(false);
    await started;

    expect(session.snapshot().status).toBe("stopped");
    expect(cursor.run).not.toHaveBeenCalled();
  });

  it("auto-retries Cursor crashes then continues", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-"));
    const gpt = mockGpt([
      { status: "continue", instruction: "do the work" },
      {
        status: "complete",
        summary: "Recovered after retry",
        next_improvements: [],
      },
    ]);

    let calls = 0;
    const cursor = {
      run: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            exitCode: null,
            stdout: "",
            stderr: "spawn failed",
            timedOut: false,
            durationMs: 5,
            estimatedTokens: 0,
            crashed: true,
            attempt: 1,
          };
        }
        return {
          ok: true,
          exitCode: 0,
          stdout: "all good",
          stderr: "",
          timedOut: false,
          durationMs: 8,
          estimatedTokens: 40,
          crashed: false,
          attempt: 2,
          chatId: "c2",
        };
      }),
    };

    const session = new RelaySession({
      gpt: gpt as never,
      cursor: cursor as never,
      collectGitSnapshot: async () =>
        gitSnap([{ path: "a.ts", status: "M", kind: "modified" }], "z"),
    });

    await session.start({
      projectPath: dir,
      task: "Recover",
      maxRounds: 4,
      openaiApiKey: "test",
      openaiModel: "gpt-test",
      cursorAgentBin: "agent",
    });

    expect(cursor.run).toHaveBeenCalledTimes(2);
    expect(session.snapshot().status).toBe("completed");
    expect(session.snapshot().summary).toMatch(/Recovered/);
  });

  it("stops on duplicate instruction without user Continue", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-"));
    const gpt = mockGpt([
      { status: "continue", instruction: "Apply the same fix again" },
      { status: "continue", instruction: "Apply the same fix again" },
    ]);
    const cursor = mockCursor([
      { stdout: "edited" },
      { stdout: "edited again" },
    ]);
    const session = new RelaySession({
      gpt: gpt as never,
      cursor: cursor as never,
      collectGitSnapshot: async () =>
        gitSnap([{ path: "x.ts", status: "M", kind: "modified" }], "unique"),
    });

    await session.start({
      projectPath: dir,
      task: "Loop trap",
      maxRounds: 6,
      openaiApiKey: "test",
      openaiModel: "gpt-test",
      cursorAgentBin: "agent",
    });

    const final = session.snapshot();
    expect(final.stopReason).toBe("duplicate_instruction");
    expect(cursor.run).toHaveBeenCalledTimes(1);
  });
});
