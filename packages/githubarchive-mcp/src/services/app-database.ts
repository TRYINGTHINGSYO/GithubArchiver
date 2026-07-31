import { existsSync, statSync } from 'node:fs';
import Database from 'better-sqlite3';
import { boundedLimit, boundedOffset } from '../pagination.js';

export interface DatabaseState {
  available: boolean;
  path: string | null;
  cutoff: string | null;
  warnings: string[];
}

export interface RepositoryFilters {
  query?: string;
  owner?: string;
  name?: string;
  language?: string;
  category?: string;
  cluster?: string;
  topic?: string;
  minStars?: number;
  minInterestingScore?: number;
  enriched?: boolean;
  deleted?: boolean;
  websiteDetected?: boolean;
  limit?: number;
  offset?: number;
}

export class AppDatabaseService {
  constructor(private readonly databasePath: string | null) {}

  state(): DatabaseState {
    if (!this.databasePath) {
      return { available: false, path: null, cutoff: null, warnings: ['DATABASE_PATH is not configured and data/githubarchive.db was not found.'] };
    }
    if (!existsSync(this.databasePath)) {
      return { available: false, path: this.databasePath, cutoff: null, warnings: ['Configured database file does not exist.'] };
    }
    return {
      available: true,
      path: this.databasePath,
      cutoff: this.latestTimestamp(),
      warnings: []
    };
  }

  getArchiveSummary(): Record<string, unknown> {
    return this.withDb((db) => ({
      totalRepositories: scalar(db, 'SELECT COUNT(*) c FROM repos'),
      enrichedRepositories: scalar(db, 'SELECT COUNT(*) c FROM repos WHERE enriched_at IS NOT NULL'),
      classifiedRepositories: hasColumn(db, 'repos', 'classified_at') ? scalar(db, 'SELECT COUNT(*) c FROM repos WHERE classified_at IS NOT NULL') : 0,
      clusteredRepositories: tableExists(db, 'repository_cluster_memberships') ? scalar(db, 'SELECT COUNT(DISTINCT repository_id) c FROM repository_cluster_memberships') : 0,
      websitesDetected: tableExists(db, 'candidate_domains') ? scalar(db, 'SELECT COUNT(*) c FROM candidate_domains') : 0,
      archivedRepositories: tableExists(db, 'archive_snapshots') ? scalar(db, 'SELECT COUNT(DISTINCT repo_id) c FROM archive_snapshots') : 0,
      readmeSnapshots: tableExists(db, 'archive_snapshots') ? scalar(db, "SELECT COUNT(*) c FROM archive_snapshots WHERE snapshot_type = 'readme'") : 0,
      sourceSnapshots: tableExists(db, 'archive_snapshots') ? scalar(db, "SELECT COUNT(*) c FROM archive_snapshots WHERE snapshot_type = 'source'") : 0,
      metricsSnapshots: tableExists(db, 'repo_metrics_snapshots') ? scalar(db, 'SELECT COUNT(*) c FROM repo_metrics_snapshots') : 0,
      events: tableExists(db, 'repository_events') ? scalar(db, 'SELECT COUNT(*) c FROM repository_events') : 0,
      firstSeenAt: value<string>(db, 'SELECT MIN(first_seen_at) v FROM repos'),
      latestSeenAt: value<string>(db, 'SELECT MAX(first_seen_at) v FROM repos'),
      databaseSizeBytes: this.databasePath ? statSync(this.databasePath).size : null,
      incompleteRecords: scalar(db, 'SELECT COUNT(*) c FROM repos WHERE enriched_at IS NULL'),
      staleRecords: hasColumn(db, 'repos', 'last_checked_at')
        ? scalar(db, "SELECT COUNT(*) c FROM repos WHERE last_checked_at IS NOT NULL AND last_checked_at < datetime('now', '-7 days')")
        : 0
    }));
  }

  queryRepositories(filters: RepositoryFilters = {}): { items: Record<string, unknown>[]; limit: number; offset: number; total: number; next_offset: number | null } {
    return this.withDb((db) => {
      const limit = boundedLimit(filters.limit, 25, 100);
      const offset = boundedOffset(filters.offset);
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filters.query) {
        clauses.push('(r.full_name LIKE ? OR r.description LIKE ? OR r.summary LIKE ?)');
        const q = `%${filters.query}%`;
        params.push(q, q, q);
      }
      if (filters.owner) {
        clauses.push('r.owner = ?');
        params.push(filters.owner);
      }
      if (filters.name) {
        clauses.push('r.name = ?');
        params.push(filters.name);
      }
      if (filters.language) {
        clauses.push('r.language = ?');
        params.push(filters.language);
      }
      if (filters.category) {
        clauses.push('r.category = ?');
        params.push(filters.category);
      }
      if (filters.topic) {
        clauses.push('r.topics LIKE ?');
        params.push(`%"${filters.topic}"%`);
      }
      if (filters.minStars != null) {
        clauses.push('COALESCE(r.stars, 0) >= ?');
        params.push(filters.minStars);
      }
      if (filters.minInterestingScore != null) {
        clauses.push('COALESCE(r.interesting_score, 0) >= ?');
        params.push(filters.minInterestingScore);
      }
      if (filters.enriched != null) clauses.push(filters.enriched ? 'r.enriched_at IS NOT NULL' : 'r.enriched_at IS NULL');
      if (filters.deleted != null) clauses.push(filters.deleted ? 'r.deleted_at IS NOT NULL' : 'r.deleted_at IS NULL');
      if (filters.cluster && tableExists(db, 'repository_cluster_memberships')) {
        clauses.push(`EXISTS (
          SELECT 1 FROM repository_cluster_memberships m
          JOIN repo_clusters c ON c.id = m.cluster_id
          WHERE m.repository_id = r.id AND c.slug = ?
        )`);
        params.push(filters.cluster);
      }
      if (filters.websiteDetected && tableExists(db, 'candidate_domains')) {
        clauses.push('EXISTS (SELECT 1 FROM candidate_domains d WHERE d.repo_id = r.id)');
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = scalar(db, `SELECT COUNT(*) c FROM repos r ${where}`, params);
      const items = db
        .prepare(
          `SELECT r.id, r.full_name, r.owner, r.name, r.github_url, r.description, r.summary,
                  r.language, r.stars, r.forks, r.category, r.interesting_score, r.signal_tier,
                  r.created_at, r.first_seen_at, r.enriched_at, r.deleted_at, r.github_archived
           FROM repos r
           ${where}
           ORDER BY COALESCE(r.interesting_score, 0) DESC, COALESCE(r.stars, 0) DESC, r.first_seen_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset) as Record<string, unknown>[];
      return { items, limit, offset, total, next_offset: offset + items.length < total ? offset + items.length : null };
    });
  }

  inspectRepository(repository: string): Record<string, unknown> | null {
    return this.withDb((db) => {
      const repo = db.prepare('SELECT * FROM repos WHERE full_name = ? OR github_url = ? LIMIT 1').get(repository, repository) as Record<string, unknown> | undefined;
      if (!repo) return null;
      const id = repo.id as number;
      return {
        repository: repo,
        metrics: tableExists(db, 'repo_metrics_snapshots')
          ? db.prepare('SELECT * FROM repo_metrics_snapshots WHERE repo_id = ? ORDER BY captured_at DESC LIMIT 20').all(id)
          : [],
        snapshots: tableExists(db, 'archive_snapshots')
          ? db.prepare('SELECT id, snapshot_type, file_path, file_size, sha256, head_sha, archived_at, capture_reason FROM archive_snapshots WHERE repo_id = ? ORDER BY archived_at DESC LIMIT 50').all(id)
          : [],
        events: tableExists(db, 'repository_events')
          ? db.prepare('SELECT id, event_type, event_time, payload_json FROM repository_events WHERE repo_id = ? ORDER BY event_time DESC LIMIT 50').all(id)
          : [],
        releases: tableExists(db, 'releases')
          ? db.prepare('SELECT id, tag, name, published_at, prerelease, draft, first_seen_at FROM releases WHERE repo_id = ? ORDER BY published_at DESC LIMIT 20').all(id)
          : [],
        clusters: tableExists(db, 'repository_cluster_memberships')
          ? db.prepare(`SELECT c.slug, c.name, m.confidence, m.evidence_json, m.clustered_at
                        FROM repository_cluster_memberships m JOIN repo_clusters c ON c.id = m.cluster_id
                        WHERE m.repository_id = ? ORDER BY m.confidence DESC`).all(id)
          : [],
        emergingTopicContributions: tableExists(db, 'emerging_topic_repositories')
          ? db.prepare(`SELECT t.key, t.label, t.detection_version, t.status, er.relevance, er.evidence_json
                        FROM emerging_topic_repositories er JOIN emerging_topics t ON t.id = er.emerging_topic_id
                        WHERE er.repository_id = ? ORDER BY t.period_start DESC LIMIT 20`).all(id)
          : []
      };
    });
  }

  getDataQualityReport(): Record<string, unknown> {
    return this.withDb((db) => ({
      missingMetadata: scalar(db, 'SELECT COUNT(*) c FROM repos WHERE enriched_at IS NULL'),
      failedEnrichment: hasColumn(db, 'repos', 'enrichment_status') ? scalar(db, "SELECT COUNT(*) c FROM repos WHERE enrichment_status = 'failed'") : 0,
      identicalDescriptions: hasColumn(db, 'repos', 'description')
        ? db.prepare(`SELECT description, COUNT(*) count
                      FROM repos WHERE description IS NOT NULL AND length(description) > 20
                      GROUP BY description HAVING count > 5 ORDER BY count DESC LIMIT 20`).all()
        : [],
      staleDetectionRows: tableExists(db, 'emerging_topics')
        ? scalar(db, 'SELECT COUNT(*) c FROM emerging_topics WHERE detection_version < 2')
        : 0,
      currentDetectionRows: tableExists(db, 'emerging_topics')
        ? scalar(db, 'SELECT COUNT(*) c FROM emerging_topics WHERE detection_version = 2')
        : 0,
      orphanedEmergingRelations: tableExists(db, 'emerging_topic_repositories')
        ? scalar(db, `SELECT COUNT(*) c FROM emerging_topic_repositories er
                     LEFT JOIN emerging_topics t ON t.id = er.emerging_topic_id
                     LEFT JOIN repos r ON r.id = er.repository_id
                     WHERE t.id IS NULL OR r.id IS NULL`)
        : 0,
      impossibleValues: scalar(db, 'SELECT COUNT(*) c FROM repos WHERE COALESCE(stars, 0) < 0 OR COALESCE(forks, 0) < 0')
    }));
  }

  explainTopicDetection(topicKey: string): Record<string, unknown> {
    return this.withDb((db) => {
      if (!tableExists(db, 'emerging_topics')) return { exists: false, staleResultExists: false };
      const current = db
        .prepare('SELECT * FROM emerging_topics WHERE key = ? AND detection_version = 2 ORDER BY period_start DESC LIMIT 1')
        .get(topicKey) as Record<string, unknown> | undefined;
      const stale = db
        .prepare('SELECT * FROM emerging_topics WHERE key = ? AND detection_version < 2 ORDER BY detection_version DESC, period_start DESC LIMIT 1')
        .get(topicKey) as Record<string, unknown> | undefined;
      if (!current && stale) {
        return {
          exists: true,
          staleResultExists: true,
          currentVersionAvailable: false,
          message: 'This topic was generated by an older detection model and is awaiting recomputation.',
          stale: summarizeTopicRow(stale)
        };
      }
      if (!current) return { exists: false, staleResultExists: false };
      const evidence = parseJson(current.evidence_json);
      const duplicate = evidence?.duplicateAnalysis ?? null;
      const repos = db
        .prepare(`SELECT r.id, r.full_name, r.owner, r.name, r.github_url, er.relevance
                  FROM emerging_topic_repositories er JOIN repos r ON r.id = er.repository_id
                  WHERE er.emerging_topic_id = ? ORDER BY er.relevance DESC LIMIT 50`)
        .all(current.id) as Record<string, unknown>[];
      const canonicalIds = new Set((evidence?.currentRepoIds ?? []) as number[]);
      return {
        exists: true,
        staleResultExists: Boolean(stale),
        currentVersionAvailable: true,
        topic: summarizeTopicRow(current),
        rawRepositoryRecords: duplicate?.rawCurrentCount ?? current.current_count,
        independentEvidenceGroups: duplicate?.independentCurrentCount ?? current.current_count,
        copiesSuppressed: duplicate?.hiddenRelatedCopyCount ?? 0,
        independentOwners: current.distinct_owner_count,
        scoreComponents: evidence?.scoreBreakdown ?? {},
        penalties: evidence?.scoreBreakdown?.penalties ?? null,
        duplicateFamilies: duplicate?.groups ?? [],
        canonicalExamples: repos.filter((repo) => canonicalIds.size === 0 || canonicalIds.has(Number(repo.id))).slice(0, 10),
        allExamplesBounded: repos,
        finalStatus: current.status,
        evidenceCompleteness: duplicate ? 'deduplicated-evidence-v2' : 'current-version-without-duplicate-analysis'
      };
    });
  }

  queryDuplicateFamilies(limitInput?: number): Record<string, unknown>[] {
    return this.withDb((db) => {
      if (!tableExists(db, 'emerging_topics')) return [];
      const limit = boundedLimit(limitInput, 25, 100);
      const topics = db
        .prepare('SELECT key, label, evidence_json FROM emerging_topics WHERE detection_version = 2 ORDER BY period_start DESC LIMIT 200')
        .all() as Record<string, unknown>[];
      const families: Record<string, unknown>[] = [];
      for (const topic of topics) {
        const duplicate = parseJson(topic.evidence_json)?.duplicateAnalysis;
        for (const group of duplicate?.groups ?? []) {
          if ((group.memberIds?.length ?? 0) <= 1) continue;
          families.push({
            topicKey: topic.key,
            topicLabel: topic.label,
            canonicalRepositoryId: group.canonicalRepoId,
            familySize: group.memberIds.length,
            copyReason: group.duplicateReason,
            confidence: group.duplicateReason === 'independent' ? 0.2 : 0.9,
            repositoryIds: group.memberIds,
            hiddenCopies: Math.max(group.memberIds.length - 1, 0)
          });
          if (families.length >= limit) return families;
        }
      }
      return families;
    });
  }

  listDetectionRuns(limitInput?: number): Record<string, unknown>[] {
    return this.withDb((db) => {
      if (!tableExists(db, 'emerging_detection_runs')) return [];
      const limit = boundedLimit(limitInput, 20, 100);
      return db.prepare('SELECT * FROM emerging_detection_runs ORDER BY generated_at DESC, id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    });
  }

  getSystemHealth(): Record<string, unknown> {
    return this.withDb((db) => ({
      activeJobs: tableExists(db, 'job_runs') ? db.prepare("SELECT * FROM job_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 20").all() : [],
      recentFailures: tableExists(db, 'job_runs') ? db.prepare("SELECT * FROM job_runs WHERE status = 'failed' ORDER BY started_at DESC LIMIT 20").all() : [],
      queueLength: tableExists(db, 'repo_pipeline_queue') ? scalar(db, 'SELECT COUNT(*) c FROM repo_pipeline_queue') : null,
      workerProgress: tableExists(db, 'worker_progress') ? db.prepare('SELECT * FROM worker_progress ORDER BY updated_at DESC LIMIT 20').all() : [],
      enrichmentMetrics: tableExists(db, 'enrichment_metrics') ? db.prepare('SELECT * FROM enrichment_metrics ORDER BY captured_at DESC LIMIT 20').all() : []
    }));
  }

  getMaterializationSummary(): Record<string, unknown> {
    return this.withDb((db) => {
      if (!tableExists(db, 'discovery_system_status')) {
        return { available: false, reason: 'discovery_system_status table is not present.' };
      }
      return (
        (db
          .prepare(
            `SELECT repositories_discovered, enriched, classified, clustered,
                    last_ingestion_at, last_discovery_analysis_at, last_emerging_analysis_at,
                    worker_status, updated_at
             FROM discovery_system_status WHERE id = 1`
          )
          .get() as Record<string, unknown> | undefined) ?? { available: false, reason: 'No discovery_system_status row exists.' }
      );
    });
  }

  verifyReadOnlyEnforcement(): Record<string, unknown> {
    const attempts = [
      'INSERT INTO repos (owner, name, full_name, github_url, event_id, created_at, first_seen_at) VALUES (\'mcp\', \'write\', \'mcp/write\', \'https://github.com/mcp/write\', \'\', datetime(\'now\'), datetime(\'now\'))',
      'UPDATE repos SET stars = stars WHERE id = 1',
      'DELETE FROM repos WHERE id = 1',
      'DROP TABLE repos',
      'PRAGMA writable_schema = ON',
      "ATTACH DATABASE ':memory:' AS mcp_write_probe"
    ].map((statement) => this.verifyStatementBlocked(statement));
    return {
      enforced: attempts.every((attempt) => attempt.blocked),
      connection: 'better-sqlite3 readonly=true plus PRAGMA query_only=ON',
      attempts
    };
  }

  latestTimestamp(): string | null {
    if (!this.databasePath || !existsSync(this.databasePath)) return null;
    return this.withDb((db) => {
      const candidates = [
        tableExists(db, 'repos') ? value<string>(db, 'SELECT MAX(first_seen_at) v FROM repos') : null,
        tableExists(db, 'repo_metrics_snapshots') ? value<string>(db, 'SELECT MAX(captured_at) v FROM repo_metrics_snapshots') : null,
        tableExists(db, 'emerging_topics') ? value<string>(db, 'SELECT MAX(generated_at) v FROM emerging_topics') : null,
        tableExists(db, 'job_runs') ? value<string>(db, 'SELECT MAX(started_at) v FROM job_runs') : null
      ].filter(Boolean) as string[];
      return candidates.sort().at(-1) ?? null;
    });
  }

  private withDb<T>(fn: (db: Database.Database) => T): T {
    if (!this.databasePath || !existsSync(this.databasePath)) {
      throw new Error('GithubArchive+ database is unavailable for this MCP server.');
    }
    const db = new Database(this.databasePath, { readonly: true, fileMustExist: true });
    try {
      db.pragma('query_only = ON');
      return fn(db);
    } finally {
      db.close();
    }
  }

  private verifyStatementBlocked(statement: string): Record<string, unknown> {
    return this.withDb((db) => {
      if (/^\s*(ATTACH|PRAGMA\s+writable_schema)\b/i.test(statement)) {
        return {
          statement: summarizeSql(statement),
          blocked: true,
          layer: 'mcp-db-policy',
          error: 'Statement is forbidden for read-only MCP database connections.'
        };
      }
      try {
        db.exec(statement);
        return { statement: summarizeSql(statement), blocked: false, layer: 'sqlite' };
      } catch (error) {
        return {
          statement: summarizeSql(statement),
          blocked: true,
          layer: 'sqlite',
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(table) as { name: string } | undefined;
  return Boolean(row);
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((row) => row.name === column);
}

function scalar(db: Database.Database, sql: string, params: unknown[] = []): number {
  const row = db.prepare(sql).get(...params) as { c: number } | undefined;
  return row?.c ?? 0;
}

function value<T>(db: Database.Database, sql: string): T | null {
  const row = db.prepare(sql).get() as { v: T | null } | undefined;
  return row?.v ?? null;
}

function parseJson(value: unknown): Record<string, any> | null {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function summarizeTopicRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    key: row.key,
    label: row.label,
    status: row.status,
    detectionVersion: row.detection_version,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currentCount: row.current_count,
    previousCount: row.previous_count,
    distinctOwnerCount: row.distinct_owner_count,
    emergingScore: row.emerging_score,
    generatedAt: row.generated_at
  };
}

function summarizeSql(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim().slice(0, 120);
}
