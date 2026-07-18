import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPlugins } from "../src/plugins/loader.js";

describe("discoverPlugins", () => {
  it("auto-detects sqlite from package.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "plug-"));
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { "better-sqlite3": "^11.0.0" },
      }),
      "utf8",
    );
    const loaded = await discoverPlugins(dir, []);
    expect(loaded.source).toBe("autodetect");
    expect(loaded.active.some((p) => p.id === "sqlite")).toBe(true);
  });

  it("loads only requested plugins from config", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "plug-"));
    const loaded = await discoverPlugins(dir, ["railway", "github"]);
    expect(loaded.source).toBe("config");
    expect(loaded.active.map((p) => p.id).sort()).toEqual(["github", "railway"]);
  });

  it("loads external plugin.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "plug-"));
    const pluginDir = path.join(dir, ".relay", "plugins", "acme");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({
        id: "acme",
        name: "Acme",
        verifyCommands: [{ name: "acme:ok", command: "true" }],
      }),
      "utf8",
    );
    const loaded = await discoverPlugins(dir, ["acme"]);
    expect(loaded.active[0]?.id).toBe("acme");
    const cmds = await loaded.active[0]!.verifyCommands!({
      projectPath: dir,
      approval: {
        before_database_changes: true,
        before_deleting_files: true,
        before_dependency_updates: true,
        before_commits: false,
        before_pushes: true,
        before_deploys: true,
        before_secret_changes: true,
      },
    });
    expect(cmds[0]?.command).toBe("true");
  });
});
