import { randomUUID } from "node:crypto";

export type TaskNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "verifying"
  | "passed"
  | "failed"
  | "blocked"
  | "skipped";

export interface TaskNode {
  id: string;
  title: string;
  detail: string;
  role?: string;
  agentHint?: string;
  dependsOn: string[];
  status: TaskNodeStatus;
  instruction?: string;
  verifySummary?: string;
  error?: string;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  /** Wall-clock duration for the latest attempt */
  durationMs?: number;
  /** Worker / agent label assigned to this node */
  workerLabel?: string;
  /** Files touched while this node ran (best-effort) */
  filesChanged?: string[];
  /** Current action string while running */
  currentAction?: string;
}

export interface TaskGraph {
  id: string;
  title: string;
  createdAt: string;
  nodes: TaskNode[];
}

export interface TaskGraphPlanInput {
  title: string;
  steps: Array<{
    id?: string;
    title: string;
    detail: string;
    role?: string;
    dependsOn?: string[];
    agentHint?: string;
  }>;
}

/** Build a DAG from planner steps. If dependsOn omitted, use linear order. */
export function buildTaskGraph(input: TaskGraphPlanInput): TaskGraph {
  const nodes: TaskNode[] = input.steps.map((step, index) => {
    const id = step.id?.trim() || `t${index + 1}`;
    // Explicit dependsOn (including []) wins; omit → linear chain.
    const dependsOn =
      step.dependsOn !== undefined
        ? [...step.dependsOn]
        : index === 0
          ? []
          : [input.steps[index - 1]?.id?.trim() || `t${index}`];
    return {
      id,
      title: step.title,
      detail: step.detail,
      role: step.role,
      agentHint: step.agentHint,
      dependsOn,
      status: "pending",
      attempts: 0,
    };
  });

  // Validate deps exist
  const ids = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    node.dependsOn = node.dependsOn.filter((d) => ids.has(d) && d !== node.id);
  }

  refreshReady(nodes);
  return {
    id: randomUUID(),
    title: input.title,
    createdAt: new Date().toISOString(),
    nodes,
  };
}

export function refreshReady(nodes: TaskNode[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    if (node.status !== "pending" && node.status !== "ready" && node.status !== "blocked") {
      continue;
    }
    const deps = node.dependsOn.map((id) => byId.get(id)).filter(Boolean) as TaskNode[];
    if (deps.some((d) => d.status === "failed")) {
      node.status = "blocked";
      continue;
    }
    if (deps.every((d) => d.status === "passed" || d.status === "skipped")) {
      node.status = "ready";
    } else {
      node.status = "pending";
    }
  }
}

export function nextReadyNodes(graph: TaskGraph, limit = 4): TaskNode[] {
  refreshReady(graph.nodes);
  return graph.nodes.filter((n) => n.status === "ready").slice(0, limit);
}

export function markRunning(node: TaskNode): void {
  node.status = "running";
  node.attempts += 1;
  node.startedAt = new Date().toISOString();
  node.error = undefined;
}

export function markVerifying(node: TaskNode): void {
  node.status = "verifying";
}

export function markPassed(node: TaskNode, verifySummary?: string): void {
  node.status = "passed";
  node.verifySummary = verifySummary;
  node.finishedAt = new Date().toISOString();
  if (node.startedAt) {
    node.durationMs = Date.parse(node.finishedAt) - Date.parse(node.startedAt);
  }
  node.currentAction = undefined;
}

export function markFailed(node: TaskNode, error: string, verifySummary?: string): void {
  node.status = "failed";
  node.error = error;
  node.verifySummary = verifySummary;
  node.finishedAt = new Date().toISOString();
  if (node.startedAt) {
    node.durationMs = Date.parse(node.finishedAt) - Date.parse(node.startedAt);
  }
  node.currentAction = undefined;
}

/** Reset a failed node (and clear blocked descendants) so only that branch reruns. */
export function retryFailedBranch(graph: TaskGraph, nodeId: string): void {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const target = byId.get(nodeId);
  if (!target) return;
  target.status = "pending";
  target.error = undefined;
  target.finishedAt = undefined;

  // Unblock nodes that were blocked solely due to this failure
  for (const node of graph.nodes) {
    if (node.status === "blocked") node.status = "pending";
  }
  refreshReady(graph.nodes);
}

export function graphProgress(graph: TaskGraph): {
  total: number;
  passed: number;
  failed: number;
  running: number;
  ready: number;
  blocked: number;
  complete: boolean;
} {
  const total = graph.nodes.length;
  const passed = graph.nodes.filter((n) => n.status === "passed" || n.status === "skipped").length;
  const failed = graph.nodes.filter((n) => n.status === "failed").length;
  const running = graph.nodes.filter(
    (n) => n.status === "running" || n.status === "verifying",
  ).length;
  const ready = graph.nodes.filter((n) => n.status === "ready").length;
  const blocked = graph.nodes.filter((n) => n.status === "blocked").length;
  return {
    total,
    passed,
    failed,
    running,
    ready,
    blocked,
    complete: passed === total && total > 0,
  };
}

export function formatGraph(graph: TaskGraph): string {
  const lines = [`${graph.title}`, ...graph.nodes.map((n) => {
    const mark =
      n.status === "passed"
        ? "✓"
        : n.status === "failed"
          ? "✗"
          : n.status === "running" || n.status === "verifying"
            ? "●"
            : n.status === "ready"
              ? "○"
              : n.status === "blocked"
                ? "■"
                : "·";
    const deps = n.dependsOn.length ? ` ← ${n.dependsOn.join(", ")}` : "";
    return `${mark} ${n.id} ${n.title} [${n.status}]${deps}`;
  })];
  return lines.join("\n");
}

export function toPlannerSteps(graph: TaskGraph): Array<{
  id: string;
  title: string;
  detail: string;
  role?: string;
  dependsOn: string[];
}> {
  return graph.nodes.map((n) => ({
    id: n.id,
    title: n.title,
    detail: n.detail,
    role: n.role,
    dependsOn: n.dependsOn,
  }));
}
