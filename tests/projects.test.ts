import { describe, expect, it } from "vitest";
import { detectProjectsFromTask } from "../src/projects.js";

describe("detectProjectsFromTask", () => {
  const index = {
    Inventory: "/repos/Inventory",
    PlexRequests: "/repos/PlexRequests",
  };

  it("matches by name mention", () => {
    const hits = detectProjectsFromTask(
      "Improve barcode scanning in Inventory",
      index,
    );
    expect(hits[0]?.name).toBe("Inventory");
    expect(hits[0]?.confidence).toBeGreaterThan(0.9);
  });

  it("matches compact name variants", () => {
    const hits = detectProjectsFromTask("fix plexrequests login", index);
    expect(hits.some((h) => h.name === "PlexRequests")).toBe(true);
  });

  it("does not hardcode parent-repo names", () => {
    const hits = detectProjectsFromTask(
      "Fix GH Archive CreateEvent matching",
      index,
    );
    expect(hits.length).toBe(0);
  });
});
