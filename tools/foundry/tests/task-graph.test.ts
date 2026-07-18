import { describe, expect, it } from "vitest";
import {
  buildTaskGraph,
  formatGraph,
  graphProgress,
  markFailed,
  markPassed,
  markRunning,
  nextReadyNodes,
  refreshReady,
  retryFailedBranch,
} from "../src/task-graph.js";

describe("task graph", () => {
  it("builds a linear DAG when dependsOn omitted", () => {
    const graph = buildTaskGraph({
      title: "Auth",
      steps: [
        { title: "Backend API", detail: "routes" },
        { title: "UI", detail: "forms" },
        { title: "Tests", detail: "coverage" },
      ],
    });
    expect(graph.nodes.map((n) => n.id)).toEqual(["t1", "t2", "t3"]);
    expect(graph.nodes[0].dependsOn).toEqual([]);
    expect(graph.nodes[1].dependsOn).toEqual(["t1"]);
    expect(graph.nodes[2].dependsOn).toEqual(["t2"]);
    expect(nextReadyNodes(graph).map((n) => n.id)).toEqual(["t1"]);
  });

  it("allows parallel ready nodes with explicit dependsOn", () => {
    const graph = buildTaskGraph({
      title: "Auth",
      steps: [
        { id: "api", title: "API", detail: "…" },
        { id: "db", title: "Migration", detail: "…", dependsOn: [] },
        { id: "ui", title: "UI", detail: "…", dependsOn: ["api", "db"] },
      ],
    });
    const ready = nextReadyNodes(graph, 4).map((n) => n.id).sort();
    expect(ready).toEqual(["api", "db"]);
  });

  it("blocks dependents on failure and retries only that branch", () => {
    const graph = buildTaskGraph({
      title: "Auth",
      steps: [
        { id: "api", title: "API", detail: "…" },
        { id: "ui", title: "UI", detail: "…", dependsOn: ["api"] },
        { id: "docs", title: "Docs", detail: "…", dependsOn: [] },
      ],
    });

    const api = graph.nodes.find((n) => n.id === "api")!;
    markRunning(api);
    markFailed(api, "boom");
    refreshReady(graph.nodes);

    expect(graph.nodes.find((n) => n.id === "ui")!.status).toBe("blocked");
    expect(nextReadyNodes(graph).map((n) => n.id)).toEqual(["docs"]);

    const docs = graph.nodes.find((n) => n.id === "docs")!;
    markRunning(docs);
    markPassed(docs);

    retryFailedBranch(graph, "api");
    expect(graph.nodes.find((n) => n.id === "api")!.status).toBe("ready");
    expect(graph.nodes.find((n) => n.id === "ui")!.status).toBe("pending");
    expect(graph.nodes.find((n) => n.id === "docs")!.status).toBe("passed");

    const progress = graphProgress(graph);
    expect(progress.passed).toBe(1);
    expect(progress.failed).toBe(0);
    expect(formatGraph(graph)).toContain("api");
  });
});
