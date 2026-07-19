import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ApprovalPolicy {
  before_database_changes: boolean;
  before_deleting_files: boolean;
  before_dependency_updates: boolean;
  before_commits: boolean;
  before_pushes: boolean;
  before_deploys: boolean;
  before_secret_changes: boolean;
  /** Foundry editing Foundry / publishing itself */
  before_self_updates: boolean;
}

export type TrustLevelConfig =
  | "read_only"
  | "safe_edits"
  | "local_autonomous"
  | "full_automation";

export interface ProjectRelayConfig {
  plugins: string[];
  approval: ApprovalPolicy;
  agent?: string;
  /** Project trust boundary (default: safe_edits) */
  trust?: TrustLevelConfig;
  require_plan_approval?: boolean;
  supervisor?: boolean;
  auto_verify?: boolean;
  browser_verify?: boolean;
}

export const DEFAULT_APPROVAL: ApprovalPolicy = {
  before_database_changes: true,
  before_deleting_files: true,
  before_dependency_updates: true,
  before_commits: false,
  before_pushes: true,
  before_deploys: true,
  before_secret_changes: true,
  before_self_updates: true,
};

export const DEFAULT_CONFIG: ProjectRelayConfig = {
  plugins: [],
  approval: { ...DEFAULT_APPROVAL },
  trust: "safe_edits",
  require_plan_approval: true,
  supervisor: true,
  auto_verify: true,
  browser_verify: false,
};

/** Minimal YAML subset parser for our config shape (no external dep required). */
export function parseSimpleYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let currentList: string[] | null = null;
  let currentMap: Record<string, unknown> | null = null;
  let currentMapKey: string | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "");
    if (!line.trim()) continue;

    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentList) {
      currentList.push(stripQuotes(listItem[1].trim()));
      continue;
    }

    const nested = line.match(/^\s{2,}([\w-]+):\s*(.*)$/);
    if (nested && currentMap) {
      const key = nested[1];
      const value = nested[2].trim();
      currentMap[key] = value === "" ? true : parseScalar(value);
      continue;
    }

    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (!top) continue;
    const key = top[1];
    const value = top[2].trim();
    currentList = null;
    currentMap = null;
    currentMapKey = null;

    if (value === "") {
      // Could be list or map — peek not available; default to map holder.
      // We'll decide on next indentation. Start as map; if list items arrive, convert.
      currentMap = {};
      currentMapKey = key;
      root[key] = currentMap;
      // Also prepare list capture if next lines are list items under this key.
      currentList = [];
      // Dual-bind: keep map; if list items appear, replace with list.
      (root as Record<string, unknown>)[`__list_${key}`] = currentList;
      continue;
    }
    root[key] = parseScalar(value);
  }

  // Resolve dual list/map holders
  for (const key of Object.keys(root)) {
    if (!key.startsWith("__list_")) continue;
    const real = key.slice("__list_".length);
    const list = root[key] as string[];
    const map = root[real];
    delete root[key];
    if (list.length > 0) {
      root[real] = list;
    } else if (map && typeof map === "object" && Object.keys(map as object).length === 0) {
      root[real] = [];
    }
  }

  return root;
}

function parseScalar(value: string): unknown {
  const v = stripQuotes(value);
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function normalizeConfig(raw: Record<string, unknown>): ProjectRelayConfig {
  const approvalRaw =
    raw.approval && typeof raw.approval === "object"
      ? (raw.approval as Record<string, unknown>)
      : {};
  const approval: ApprovalPolicy = { ...DEFAULT_APPROVAL };
  for (const key of Object.keys(DEFAULT_APPROVAL) as Array<keyof ApprovalPolicy>) {
    if (typeof approvalRaw[key] === "boolean") {
      approval[key] = approvalRaw[key] as boolean;
    }
  }

  const plugins = Array.isArray(raw.plugins)
    ? raw.plugins.filter((p): p is string => typeof p === "string")
    : [];

  const trustRaw = typeof raw.trust === "string" ? raw.trust : undefined;
  const trust =
    trustRaw === "read_only" ||
    trustRaw === "safe_edits" ||
    trustRaw === "local_autonomous" ||
    trustRaw === "full_automation"
      ? trustRaw
      : trustRaw === "read-only"
        ? "read_only"
        : trustRaw === "safe-edits"
          ? "safe_edits"
          : trustRaw === "local-autonomous"
            ? "local_autonomous"
            : trustRaw === "full-automation"
              ? "full_automation"
              : DEFAULT_CONFIG.trust;

  return {
    plugins,
    approval,
    trust,
    agent: typeof raw.agent === "string" ? raw.agent : undefined,
    require_plan_approval:
      typeof raw.require_plan_approval === "boolean"
        ? raw.require_plan_approval
        : DEFAULT_CONFIG.require_plan_approval,
    supervisor:
      typeof raw.supervisor === "boolean"
        ? raw.supervisor
        : DEFAULT_CONFIG.supervisor,
    auto_verify:
      typeof raw.auto_verify === "boolean"
        ? raw.auto_verify
        : DEFAULT_CONFIG.auto_verify,
    browser_verify:
      typeof raw.browser_verify === "boolean"
        ? raw.browser_verify
        : DEFAULT_CONFIG.browser_verify,
  };
}

export async function loadProjectConfig(
  projectPath: string,
): Promise<{ config: ProjectRelayConfig; source: string | null }> {
  const candidates = [
    "foundry.config.yaml",
    "foundry.config.yml",
    "foundry.config.json",
    ".foundry/config.yaml",
    ".foundry/config.yml",
    ".foundry/config.json",
    // Legacy aliases from pre-rename "relay"
    "relay.config.yaml",
    "relay.config.yml",
    "relay.config.json",
    ".relay/config.yaml",
    ".relay/config.yml",
    ".relay/config.json",
  ];

  for (const rel of candidates) {
    const full = path.join(projectPath, rel);
    try {
      const text = await readFile(full, "utf8");
      if (rel.endsWith(".json")) {
        const raw = JSON.parse(text) as Record<string, unknown>;
        return { config: normalizeConfig(raw), source: rel };
      }
      return { config: normalizeConfig(parseSimpleYaml(text)), source: rel };
    } catch {
      // try next
    }
  }
  return { config: { ...DEFAULT_CONFIG, approval: { ...DEFAULT_APPROVAL } }, source: null };
}
