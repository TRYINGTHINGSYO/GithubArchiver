import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TimelineEvent } from "./timeline.js";
import type {
  ExecutionPlan,
  RelayStatus,
  RollbackCheckpoint,
  RoundRecord,
  WorkerResult,
} from "./types.js";

export interface RecoverableSession {
  version: 1;
  sessionId: string;
  updatedAt: string;
  projectPath: string;
  projectName: string;
  task: string;
  status: RelayStatus;
  round: number;
  maxRounds: number;
  planApproved: boolean;
  pendingPlan: ExecutionPlan | null;
  workers: WorkerResult[];
  rounds: RoundRecord[];
  cursorChatId: string | null;
  checkpoint: RollbackCheckpoint | null;
  timeline: TimelineEvent[];
  summary: string | null;
  stopReason: string | null;
  flags: {
    requirePlanApproval: boolean;
    supervisorEnabled: boolean;
    autoVerify: boolean;
    browserVerify: boolean;
  };
  plugins: string[];
}

function recoveryDir(env: NodeJS.ProcessEnv = process.env): string {
  const root =
    env.RELAY_MEMORY_DIR ||
    path.join(env.HOME || env.USERPROFILE || process.cwd(), ".gpt-cursor-relay");
  return path.join(root, "sessions");
}

function sessionFile(sessionId: string): string {
  return path.join(recoveryDir(), `${sessionId}.json`);
}

export async function saveRecoverableSession(
  session: RecoverableSession,
): Promise<void> {
  const dir = recoveryDir();
  await mkdir(dir, { recursive: true });
  const file = sessionFile(session.sessionId);
  const tmp = `${file}.tmp`;
  const payload = { ...session, updatedAt: new Date().toISOString() };
  await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await rename(tmp, file);
}

export async function loadRecoverableSession(
  sessionId: string,
): Promise<RecoverableSession | null> {
  try {
    const raw = await readFile(sessionFile(sessionId), "utf8");
    return JSON.parse(raw) as RecoverableSession;
  } catch {
    return null;
  }
}

export async function listRecoverableSessions(): Promise<RecoverableSession[]> {
  const dir = recoveryDir();
  let names: string[] = [];
  try {
    const { readdir } = await import("node:fs/promises");
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const sessions: RecoverableSession[] = [];
  for (const name of names) {
    try {
      const raw = await readFile(path.join(dir, name), "utf8");
      const parsed = JSON.parse(raw) as RecoverableSession;
      if (parsed.version === 1) sessions.push(parsed);
    } catch {
      // skip corrupt
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function clearRecoverableSession(sessionId: string): Promise<void> {
  await rm(sessionFile(sessionId), { force: true });
}

export function formatRecoverySummary(session: RecoverableSession): string {
  const workerLines = session.workers.length
    ? session.workers
        .map((w) => `${w.ok ? "✓" : "●"} ${w.role} ${w.ok ? "complete" : "paused/failed"}`)
        .join("\n")
    : "(no parallel workers recorded)";
  return [
    `Project: ${session.projectName}`,
    `Task: ${session.task}`,
    `Round: ${session.round}/${session.maxRounds}`,
    `Status: ${session.status}`,
    "",
    "Cursor workers:",
    workerLines,
  ].join("\n");
}
