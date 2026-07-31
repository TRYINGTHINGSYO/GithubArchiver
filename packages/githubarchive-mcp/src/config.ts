import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface McpConfig {
  repoRoot: string;
  databasePath: string | null;
  productionBaseUrl: string | null;
  maxRows: number;
  queryTimeoutMs: number;
}

export function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(resolve(current, 'package.json')) && existsSync(resolve(current, 'src'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export function getConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  const repoRoot = overrides.repoRoot ?? process.env.GITHUBARCHIVE_REPO_ROOT ?? findRepoRoot();
  const defaultDb = resolve(repoRoot, 'data', 'githubarchive.db');
  const databasePath =
    overrides.databasePath !== undefined
      ? overrides.databasePath
      : process.env.DATABASE_PATH || (existsSync(defaultDb) ? defaultDb : null);
  return {
    repoRoot,
    databasePath,
    productionBaseUrl: overrides.productionBaseUrl ?? process.env.GITHUBARCHIVE_PRODUCTION_URL ?? null,
    maxRows: overrides.maxRows ?? Number(process.env.GITHUBARCHIVE_MCP_MAX_ROWS ?? 100),
    queryTimeoutMs: overrides.queryTimeoutMs ?? Number(process.env.GITHUBARCHIVE_MCP_QUERY_TIMEOUT_MS ?? 2500)
  };
}
