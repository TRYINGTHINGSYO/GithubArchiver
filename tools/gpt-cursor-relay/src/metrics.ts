import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TaskMetric {
  id: string;
  projectName: string;
  task: string;
  startedAt: string;
  endedAt: string;
  status: string;
  stopReason: string | null;
  rounds: number;
  durationMs: number;
  costUsd: number;
  verifyFailures: number;
  success: boolean;
}

export interface MetricsSummary {
  tasks: number;
  successes: number;
  successRate: number;
  averageRounds: number;
  averageDurationMs: number;
  averageCostUsd: number;
  verifyFailures: number;
  stopReasons: Record<string, number>;
  recent: TaskMetric[];
}

function metricsPath(env: NodeJS.ProcessEnv = process.env): string {
  const root =
    env.RELAY_MEMORY_DIR ||
    path.join(env.HOME || env.USERPROFILE || process.cwd(), ".gpt-cursor-relay");
  return path.join(root, "metrics.json");
}

export async function loadMetrics(): Promise<TaskMetric[]> {
  try {
    const raw = await readFile(metricsPath(), "utf8");
    const parsed = JSON.parse(raw) as { tasks?: TaskMetric[] };
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    return [];
  }
}

export async function recordTaskMetric(metric: TaskMetric): Promise<void> {
  const tasks = await loadMetrics();
  tasks.push(metric);
  const trimmed = tasks.slice(-500);
  const file = metricsPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ tasks: trimmed }, null, 2), "utf8");
}

export function summarizeMetrics(tasks: TaskMetric[]): MetricsSummary {
  const n = tasks.length;
  const successes = tasks.filter((t) => t.success).length;
  const stopReasons: Record<string, number> = {};
  let rounds = 0;
  let duration = 0;
  let cost = 0;
  let verifyFailures = 0;
  for (const t of tasks) {
    rounds += t.rounds;
    duration += t.durationMs;
    cost += t.costUsd;
    verifyFailures += t.verifyFailures;
    const reason = t.stopReason || t.status;
    stopReasons[reason] = (stopReasons[reason] || 0) + 1;
  }
  return {
    tasks: n,
    successes,
    successRate: n ? successes / n : 0,
    averageRounds: n ? rounds / n : 0,
    averageDurationMs: n ? duration / n : 0,
    averageCostUsd: n ? cost / n : 0,
    verifyFailures,
    stopReasons,
    recent: tasks.slice(-20).reverse(),
  };
}
