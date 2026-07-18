import { describe, expect, it } from "vitest";
import { detectProjectsFromTask } from "../src/projects.js";

describe("detectProjectsFromTask", () => {
  const index = {
    GithubArchiver: "/repos/GithubArchiver",
    SiegeQueue: "/repos/SiegeQueue",
  };

  it("detects explicit project name in task", () => {
    const hits = detectProjectsFromTask(
      "Fix SiegeQueue mobile overlay",
      index,
    );
    expect(hits[0]?.name).toBe("SiegeQueue");
    expect(hits[0]?.path).toBe("/repos/SiegeQueue");
  });

  it("detects GithubArchiver via pattern hints", () => {
    const hits = detectProjectsFromTask(
      "Fix the cluster link on the archive homepage",
      index,
    );
    expect(hits.some((h) => h.name === "GithubArchiver")).toBe(true);
  });
});
