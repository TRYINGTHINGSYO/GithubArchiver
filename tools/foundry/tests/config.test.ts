import { describe, expect, it } from "vitest";
import {
  normalizeConfig,
  parseSimpleYaml,
} from "../src/config.js";

describe("parseSimpleYaml + normalizeConfig", () => {
  it("parses plugins list and approval policy", () => {
    const raw = parseSimpleYaml(`
plugins:
  - playwright
  - railway
  - sqlite

approval:
  before_database_changes: true
  before_deleting_files: true
  before_dependency_updates: true
  before_commits: false
  before_pushes: true
  before_deploys: true
  before_secret_changes: true

require_plan_approval: true
auto_verify: true
`);
    const config = normalizeConfig(raw);
    expect(config.plugins).toEqual(["playwright", "railway", "sqlite"]);
    expect(config.approval.before_commits).toBe(false);
    expect(config.approval.before_pushes).toBe(true);
    expect(config.require_plan_approval).toBe(true);
  });
});
