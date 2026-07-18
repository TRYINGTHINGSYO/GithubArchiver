import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RelaySession } from "../src/relay.js";
import type { GptDecision } from "../src/types.js";

function mockGpt(decisions: GptDecision[]) {
  const queue = [...decisions];
  return {
    planTurn: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error("No more GPT decisions");
      return next;
    }),
  };
}

function mockCursor(results: Array<{ ok?: boolean; stdout?: string }> = []) {
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
      };
    }),
  };
}

describe("RelaySession", () => {
  it("runs GPT → Cursor → complete and lists changed files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-"));
    await writeFile(path.join(dir, "note.txt"), "hi\n", "utf8");

    const gpt = mockGpt([
      {
        status: "continue",
        instruction: "Edit note.txt and explain what you changed",
      },
      {
        status: "complete",
        summary: "Fixed the note and verified locally.",
      },
    ]);
    const cursor = mockCursor([{ stdout: "Updated note.txt" }]);
    const session = new RelaySession({
      gpt: gpt as never,
      cursor: cursor as never,
      listChangedFiles: async () => [{ status: "M", path: "note.txt" }],
    });

    const snapshots: string[] = [];
    session.subscribe((snap) => snapshots.push(snap.status));

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
    expect(final.changedFiles).toEqual([{ status: "M", path: "note.txt" }]);
    expect(gpt.planTurn).toHaveBeenCalledTimes(2);
    expect(cursor.run).toHaveBeenCalledTimes(1);
    const cursorCalls = cursor.run.mock.calls as unknown as Array<
      [{ instruction: string }]
    >;
    expect(cursorCalls[0]?.[0]?.instruction).toContain("Edit note.txt");
    expect(snapshots).toContain("running");
    expect(snapshots.at(-1)).toBe("completed");
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
      listChangedFiles: async () => [],
    });

    const started = session.start({
      projectPath: dir,
      task: "Ship it",
      maxRounds: 3,
      openaiApiKey: "test",
      openaiModel: "gpt-test",
      cursorAgentBin: "agent",
    });

    // Wait until approval is pending.
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

  it("stops at max rounds", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay-"));
    const gpt = mockGpt([
      { status: "continue", instruction: "step one" },
      { status: "continue", instruction: "step two" },
    ]);
    const cursor = mockCursor([{ stdout: "a" }, { stdout: "b" }]);
    const session = new RelaySession({
      gpt: gpt as never,
      cursor: cursor as never,
      listChangedFiles: async () => [],
    });

    await session.start({
      projectPath: dir,
      task: "Never ends",
      maxRounds: 2,
      openaiApiKey: "test",
      openaiModel: "gpt-test",
      cursorAgentBin: "agent",
    });

    const final = session.snapshot();
    expect(final.status).toBe("completed");
    expect(final.summary).toMatch(/max rounds/i);
    expect(cursor.run).toHaveBeenCalledTimes(2);
  });
});
