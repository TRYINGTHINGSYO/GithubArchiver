import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfig } from '../src/config.js';
import { GithubArchiveMcpServer } from '../src/server.js';
import { validateProductRegistry } from '../src/services/product-registry-validator.js';
import { GithubArchiveMcpTools } from '../src/tools/registry.js';

let tmp: string;
let dbPath: string;
let tools: GithubArchiveMcpTools;

const repoRoot = resolve(process.cwd());

describe('GithubArchive+ MCP tools', () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'githubarchive-mcp-test-'));
    dbPath = join(tmp, 'test.db');
    seedDatabase(dbPath);
    tools = new GithubArchiveMcpTools(getConfig({ repoRoot, databasePath: dbPath }));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('lists the production feature registry', async () => {
    const result = await tools.call('list_features', {});
    const features = (result.data as { features: Array<{ id: string }> }).features;
    expect(features.some((feature) => feature.id === 'emerging-topic-evidence-dedupe')).toBe(true);
    expect(features.some((feature) => feature.id === 'stale-topic-recomputation-page')).toBe(true);
  });

  it('validates that copied-repository emerging-topic dedupe already exists', async () => {
    const result = await tools.call('validate_proposed_change', {
      proposal: 'Add independent repository evidence grouping to emerging topics'
    });
    const data = result.data as {
      alreadyImplemented: boolean;
      evidence: { features: string[]; detectionVersion: number };
      facts: unknown[];
      inferences: string[];
      recommendations: string[];
      recommendation: string;
    };
    expect(data.alreadyImplemented).toBe(true);
    expect(data.facts.length).toBeGreaterThan(0);
    expect(data.inferences.join(' ')).toContain('existing production capabilities');
    expect(data.recommendations.join(' ')).toContain('Do not rebuild');
    expect(data.evidence.features).toContain('emerging-topic-evidence-dedupe');
    expect(data.evidence.features).toContain('stale-detection-version-filtering');
    expect(data.evidence.detectionVersion).toBe(2);
    expect(data.recommendation).toContain('Do not rebuild');
  });

  it('reports stale v1-only topics as awaiting recomputation', async () => {
    const result = await tools.call('explain_topic_detection', { topic: 'telegram-vpn' });
    const data = result.data as {
      staleResultExists: boolean;
      currentVersionAvailable: boolean;
      message: string;
    };
    expect(data.staleResultExists).toBe(true);
    expect(data.currentVersionAvailable).toBe(false);
    expect(data.message).toContain('awaiting recomputation');
  });

  it('explains v2 duplicate evidence without recommending the same feature again', async () => {
    const result = await tools.call('explain_topic_detection', { topic: 'zapret' });
    const data = result.data as {
      rawRepositoryRecords: number;
      independentEvidenceGroups: number;
      copiesSuppressed: number;
      topic: { detectionVersion: number };
    };
    expect(data.topic.detectionVersion).toBe(2);
    expect(data.rawRepositoryRecords).toBe(36);
    expect(data.independentEvidenceGroups).toBe(1);
    expect(data.copiesSuppressed).toBe(35);
  });

  it('bounds repository results and paginates', async () => {
    const result = await tools.call('query_repositories', { limit: 500, offset: 0 });
    const data = result.data as { items: unknown[]; limit: number; total: number; next_offset: number | null };
    expect(data.limit).toBe(100);
    expect(data.items.length).toBeLessThanOrEqual(100);
    expect(data.total).toBeGreaterThan(100);
    expect(data.next_offset).toBe(100);
  });

  it('redacts secret-like values from tool output', async () => {
    const result = await tools.call('inspect_repository', { repository: 'secret-owner/secret-repo' });
    expect(JSON.stringify(result)).not.toContain('ghp_123456789012345678901234567890123456');
    expect(JSON.stringify(result)).toContain('[REDACTED]');
  });

  it('does not expose arbitrary SQL or write tools', () => {
    const names = tools.listToolDefinitions().map((tool) => tool.name);
    expect(names).not.toContain('query_sql');
    expect(names).not.toContain('execute_sql');
    expect(names).not.toContain('shell');
    expect(names).not.toContain('deploy');
  });

  it('blocks unsafe source traversal and repo-internal reads', () => {
    expect(tools.source.readRelative('../../.env')).toBeNull();
    expect(tools.source.readRelative('.git/config')).toBeNull();
    expect(tools.source.readRelative('node_modules/example/index.js')).toBeNull();
    expect(tools.source.readRelative(resolve(repoRoot, 'package.json'))).toBeNull();
    expect(tools.source.readRelative('package.json')).toContain('githubarchive-plus');
  });

  it('verifies SQLite read-only enforcement for write-shaped statements', async () => {
    const result = await tools.call('verify_read_only_enforcement', {});
    const data = result.data as { enforced: boolean; attempts: Array<{ blocked: boolean }> };
    expect(data.enforced).toBe(true);
    expect(data.attempts.every((attempt) => attempt.blocked)).toBe(true);
  });

  it('validates the product registry against source, routes, tests, commits, and detection version', async () => {
    const result = await tools.call('validate_product_registry', {});
    const data = result.data as { valid: boolean; errors: unknown[]; warnings: Array<{ field?: string }>; checked: { detectionVersion: number | null } };
    expect(data.valid).toBe(true);
    expect(data.errors).toHaveLength(0);
    expect(data.checked.detectionVersion).toBe(2);
    expect(data.warnings.some((warning) => warning.field === 'last_changed_commit')).toBe(true);

    const direct = validateProductRegistry(repoRoot);
    expect(direct.valid).toBe(true);
  });

  it('returns a compact project state snapshot', async () => {
    const result = await tools.call('get_project_state', {});
    const data = result.data as {
      source: { shortCommit: string | null; dirty: boolean };
      database: { repositories: number | null; enriched: number | null };
      algorithms: { emergingDetectionVersion: number | null };
      runs: { latestEmergingDetection: { detection_version: number } | null };
      materializations: { homepage: { worker_status?: string } };
    };
    expect(data.source.shortCommit).toBeTruthy();
    expect(typeof data.source.dirty).toBe('boolean');
    expect(data.database.repositories).toBe(131);
    expect(data.database.enriched).toBe(131);
    expect(data.algorithms.emergingDetectionVersion).toBe(2);
    expect(data.runs.latestEmergingDetection?.detection_version).toBe(2);
    expect(data.materializations.homepage.worker_status).toBe('healthy');
  });

  it('supports MCP initialize, list, call, and resources', async () => {
    const server = new GithubArchiveMcpServer(getConfig({ repoRoot, databasePath: dbPath }));
    const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(JSON.stringify(init)).toContain('githubarchive-plus-mcp');
    const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(JSON.stringify(listed)).toContain('validate_proposed_change');
    const called = await server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search_existing_capabilities', arguments: { query: 'duplicate evidence families' } }
    });
    expect(JSON.stringify(called)).toContain('emerging-topic-evidence-dedupe');
    const resources = await server.handle({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
    expect(JSON.stringify(resources)).toContain('githubarchive://product/features');
  });
});

function seedDatabase(path: string) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL UNIQUE,
      github_url TEXT NOT NULL,
      event_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      description TEXT,
      summary TEXT,
      language TEXT,
      stars INTEGER,
      forks INTEGER,
      category TEXT,
      interesting_score INTEGER,
      signal_tier TEXT,
      topics TEXT,
      enriched_at TEXT,
      deleted_at TEXT,
      github_archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE repo_metrics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      stars INTEGER NOT NULL,
      forks INTEGER NOT NULL,
      watchers INTEGER NOT NULL,
      open_issues INTEGER NOT NULL,
      size INTEGER NOT NULL,
      captured_at TEXT NOT NULL
    );
    CREATE TABLE archive_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      snapshot_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      head_sha TEXT,
      archived_at TEXT NOT NULL,
      capture_reason TEXT NOT NULL DEFAULT 'daemon'
    );
    CREATE TABLE repository_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_time TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE emerging_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      candidate_type TEXT NOT NULL,
      status TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      current_count INTEGER NOT NULL,
      previous_count INTEGER NOT NULL,
      distinct_owner_count INTEGER NOT NULL,
      average_interesting_score REAL,
      novelty_score REAL NOT NULL,
      momentum_score REAL,
      quality_score REAL NOT NULL,
      emerging_score REAL NOT NULL,
      evidence_json TEXT NOT NULL,
      history_json TEXT,
      detection_version INTEGER NOT NULL,
      generated_at TEXT NOT NULL
    );
    CREATE TABLE emerging_topic_repositories (
      emerging_topic_id INTEGER NOT NULL,
      repository_id INTEGER NOT NULL,
      relevance REAL NOT NULL,
      evidence_json TEXT
    );
    CREATE TABLE job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      detail_json TEXT NOT NULL DEFAULT '{}',
      error TEXT
    );
    CREATE TABLE repo_clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE repository_cluster_memberships (
      repository_id INTEGER NOT NULL,
      cluster_id INTEGER NOT NULL,
      confidence REAL NOT NULL,
      evidence_json TEXT,
      clustered_at TEXT NOT NULL
    );
    CREATE TABLE emerging_detection_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      detection_version INTEGER NOT NULL,
      candidates_detected INTEGER NOT NULL DEFAULT 0,
      growth_suppressed_reason TEXT,
      current_window_json TEXT NOT NULL,
      previous_window_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
    CREATE TABLE discovery_system_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      repositories_discovered INTEGER NOT NULL DEFAULT 0,
      enriched INTEGER NOT NULL DEFAULT 0,
      classified INTEGER NOT NULL DEFAULT 0,
      clustered INTEGER NOT NULL DEFAULT 0,
      last_ingestion_at TEXT,
      last_discovery_analysis_at TEXT,
      last_emerging_analysis_at TEXT,
      worker_status TEXT NOT NULL DEFAULT 'unknown',
      updated_at TEXT NOT NULL
    );
  `);

  const insertRepo = db.prepare(`
    INSERT INTO repos (owner, name, full_name, github_url, created_at, first_seen_at, description, summary, language, stars, forks, category, interesting_score, signal_tier, topics, enriched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < 130; i++) {
    insertRepo.run(
      `owner-${i}`,
      `repo-${i}`,
      `owner-${i}/repo-${i}`,
      `https://github.com/owner-${i}/repo-${i}`,
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      i < 36 ? 'Copied Zapret Telegram VPN unblocker notes' : 'Example repo',
      'Example summary',
      'TypeScript',
      i,
      0,
      'ai-project',
      i,
      'medium',
      '["zapret","telegram-vpn"]',
      '2026-07-01T01:00:00.000Z'
    );
  }
  insertRepo.run(
    'secret-owner',
    'secret-repo',
    'secret-owner/secret-repo',
    'https://github.com/secret-owner/secret-repo',
    '2026-07-01T00:00:00.000Z',
    '2026-07-01T00:00:00.000Z',
    'contains ghp_123456789012345678901234567890123456 token',
    'secret summary',
    'TypeScript',
    1,
    0,
    'ai-project',
    1,
    'low',
    '[]',
    '2026-07-01T01:00:00.000Z'
  );

  db.prepare(`
    INSERT INTO emerging_topics (key, label, candidate_type, status, period_start, period_end, current_count, previous_count, distinct_owner_count, average_interesting_score, novelty_score, momentum_score, quality_score, emerging_score, evidence_json, history_json, detection_version, generated_at)
    VALUES (?, ?, 'topic', 'detected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?)
  `).run(
    'telegram-vpn',
    'Telegram VPN',
    '2026-07-01T00:00:00.000Z',
    '2026-07-08T00:00:00.000Z',
    36,
    1,
    20,
    12,
    100,
    100,
    80,
    81,
    JSON.stringify({ currentRepoIds: [], previousRepoIds: [], exampleRepos: [] }),
    1,
    '2026-07-08T00:00:00.000Z'
  );
  const evidence = {
    currentRepoIds: [1],
    previousRepoIds: [],
    exampleRepos: [{ id: 1, fullName: 'owner-0/repo-0', owner: 'owner-0', interestingScore: 18, signalTier: 'low' }],
    scoreBreakdown: { momentum: 0, novelty: 20, quality: 10, ownerDiversity: 0, categoryDiversity: 0, penalties: 25 },
    ratios: { lowSignal: 1, singleOwnerShare: 1, schoolAssignmentShare: 0, duplicateName: 0.97 },
    prevalence: { current: 1, previous: 0, liftPercent: null },
    sources: { topic: 36 },
    aliasHits: {},
    duplicateAnalysis: {
      rawCurrentCount: 36,
      independentCurrentCount: 1,
      hiddenRelatedCopyCount: 35,
      largestDuplicateFamilySize: 36,
      scorePenalty: 25,
      groups: [{ canonicalRepoId: 1, memberIds: Array.from({ length: 36 }, (_, i) => i + 1), duplicateReason: 'exact-description-copy' }]
    }
  };
  const info = db.prepare(`
    INSERT INTO emerging_topics (key, label, candidate_type, status, period_start, period_end, current_count, previous_count, distinct_owner_count, average_interesting_score, novelty_score, momentum_score, quality_score, emerging_score, evidence_json, history_json, detection_version, generated_at)
    VALUES (?, ?, 'topic', 'dismissed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?)
  `).run(
    'zapret',
    'Zapret',
    '2026-07-08T00:00:00.000Z',
    '2026-07-15T00:00:00.000Z',
    1,
    0,
    1,
    18,
    20,
    0,
    10,
    12,
    JSON.stringify(evidence),
    2,
    '2026-07-15T00:00:00.000Z'
  );
  const link = db.prepare('INSERT INTO emerging_topic_repositories (emerging_topic_id, repository_id, relevance, evidence_json) VALUES (?, ?, ?, ?)');
  for (let i = 1; i <= 36; i++) link.run(info.lastInsertRowid, i, 1, '{}');
  db.prepare(`
    INSERT INTO emerging_detection_runs (period_start, period_end, detection_version, candidates_detected, growth_suppressed_reason, current_window_json, previous_window_json, generated_at)
    VALUES (?, ?, 2, 1, null, '{}', '{}', ?)
  `).run('2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
  db.prepare(`
    INSERT INTO discovery_system_status (id, repositories_discovered, enriched, classified, clustered, last_ingestion_at, last_discovery_analysis_at, last_emerging_analysis_at, worker_status, updated_at)
    VALUES (1, 131, 131, 0, 0, ?, ?, ?, 'healthy', ?)
  `).run('2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
  db.close();
}
