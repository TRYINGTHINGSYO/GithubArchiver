import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadRegistry,
  upsertProject,
  registryAsKnownMap,
} from "../src/registry/projects.js";
import { buildProjectIndex } from "../src/projects.js";

describe("project registry and open/index", () => {
  const dirs: string[] = [];
  const prevHome = process.env.FOUNDRY_HOME;

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.FOUNDRY_HOME;
    else process.env.FOUNDRY_HOME = prevHome;
    for (const d of dirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("registers and indexes an existing project", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "foundry-reg-"));
    const projectRoot = await mkdtemp(path.join(tmpdir(), "foundry-app-"));
    dirs.push(home, projectRoot);
    process.env.FOUNDRY_HOME = home;

    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "existing-app", version: "0.0.1" }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "src"), { recursive: true });

    const entry = await upsertProject({
      name: "ExistingApp",
      path: projectRoot,
      lastTask: "Indexed for Foundry",
    });
    expect(entry.name).toBe("ExistingApp");
    expect(entry.path).toBe(projectRoot);

    const registry = await loadRegistry(home);
    expect(registry.projects.some((p) => p.name === "ExistingApp")).toBe(true);

    const known = await registryAsKnownMap(home);
    expect(known.ExistingApp).toBe(projectRoot);

    const index = await buildProjectIndex({
      known: {},
      searchRoots: [],
    });
    expect(index.ExistingApp).toBe(projectRoot);
  });
});
