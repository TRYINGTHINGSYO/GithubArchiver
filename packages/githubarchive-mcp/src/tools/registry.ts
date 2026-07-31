import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpConfig } from '../config.js';
import type { ToolDefinition, ToolEnvelope } from '../schemas/common.js';
import { nowIso } from '../schemas/common.js';
import { redact } from '../redaction.js';
import { AppDatabaseService } from '../services/app-database.js';
import { AnalysisService } from '../services/analysis-service.js';
import { DecisionJournalService } from '../services/decision-journal.js';
import { FeatureRegistryService } from '../services/feature-registry.js';
import { GitService } from '../services/git-service.js';
import { validateProductRegistry } from '../services/product-registry-validator.js';
import { RouteInspectorService } from '../services/route-inspector.js';
import { SourceIndexService } from '../services/source-index.js';

export class GithubArchiveMcpTools {
  readonly features: FeatureRegistryService;
  readonly decisions: DecisionJournalService;
  readonly git: GitService;
  readonly source: SourceIndexService;
  readonly routes: RouteInspectorService;
  readonly db: AppDatabaseService;
  readonly analysis: AnalysisService;

  constructor(private readonly config: McpConfig) {
    this.features = new FeatureRegistryService(config.repoRoot);
    this.decisions = new DecisionJournalService(config.repoRoot);
    this.git = new GitService(config.repoRoot);
    this.source = new SourceIndexService(config.repoRoot);
    this.routes = new RouteInspectorService(config.repoRoot, this.source, this.features);
    this.db = new AppDatabaseService(config.databasePath);
    this.analysis = new AnalysisService(this.features, this.decisions, this.source, this.git, this.routes, this.db);
  }

  listToolDefinitions(): ToolDefinition[] {
    return TOOL_NAMES.map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name] ?? `GithubArchive+ read-only tool: ${name}`,
      inputSchema: { type: 'object', additionalProperties: true }
    }));
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolEnvelope<unknown>> {
    let data: unknown;
    const warnings: string[] = [];
    switch (name) {
      case 'get_project_state':
        data = this.getProjectState();
        break;
      case 'get_product_overview':
        data = this.getProductOverview();
        break;
      case 'list_features':
        data = { features: this.features.list() };
        break;
      case 'get_feature_detail':
        data = this.getFeatureDetail(String(args.feature ?? args.id ?? ''));
        break;
      case 'search_existing_capabilities':
        data = this.analysis.searchExistingCapabilities(String(args.query ?? ''));
        break;
      case 'search_product_decisions':
        data = { decisions: this.decisions.search(String(args.query ?? '')).map(publicDecision) };
        break;
      case 'get_product_decision':
        data = this.decisions.get(String(args.id ?? args.decision ?? ''));
        break;
      case 'list_routes':
        data = { routes: this.routes.listRoutes() };
        break;
      case 'inspect_route':
        data = this.routes.inspectRoute(String(args.path ?? '/'));
        break;
      case 'inspect_navigation':
        data = this.routes.inspectNavigation();
        break;
      case 'capture_page_snapshot':
        data = await this.capturePageSnapshot(String(args.path ?? '/'));
        break;
      case 'compare_page_snapshots':
        data = { supported: false, reason: 'Snapshot persistence is not implemented yet; capture_page_snapshot returns one bounded snapshot at a time.' };
        break;
      case 'search_code':
        data = { matches: this.source.search(String(args.query ?? ''), Number(args.limit ?? 50)) };
        break;
      case 'get_symbol':
        data = this.source.getSymbol(String(args.symbol ?? ''), Number(args.limit ?? 50));
        break;
      case 'get_recent_commits':
        data = { commits: this.git.recentCommits(Number(args.limit ?? 10)) };
        break;
      case 'explain_change_history':
        data = this.analysis.explainChangeHistory(String(args.feature ?? ''), Number(args.limit ?? 20));
        break;
      case 'find_uncovered_code':
      case 'inspect_test_coverage':
        data = this.inspectCoverage();
        break;
      case 'get_archive_summary':
        data = this.db.getArchiveSummary();
        break;
      case 'query_repositories':
        data = this.db.queryRepositories(args);
        break;
      case 'inspect_repository':
        data = this.db.inspectRepository(String(args.repository ?? args.full_name ?? ''));
        break;
      case 'get_data_quality_report':
        data = this.db.getDataQualityReport();
        break;
      case 'query_duplicate_families':
        data = { families: this.db.queryDuplicateFamilies(Number(args.limit ?? 25)) };
        break;
      case 'explain_topic_detection':
        data = this.db.explainTopicDetection(String(args.topic ?? args.key ?? ''));
        break;
      case 'compare_detection_versions':
        data = this.compareDetectionVersions(String(args.topic ?? args.key ?? ''));
        break;
      case 'list_detection_runs':
        data = { runs: this.db.listDetectionRuns(Number(args.limit ?? 20)) };
        break;
      case 'explain_repository_score':
        data = this.explainRepositoryScore(String(args.repository ?? ''));
        break;
      case 'inspect_cluster':
        data = this.inspectCluster(String(args.cluster ?? args.slug ?? ''));
        break;
      case 'inspect_classification':
        data = this.inspectClassification(String(args.category ?? ''));
        break;
      case 'get_system_health':
      case 'get_job_status':
        data = this.db.getSystemHealth();
        break;
      case 'verify_read_only_enforcement':
        data = this.db.verifyReadOnlyEnforcement();
        break;
      case 'list_recent_failures':
        data = { failures: (this.db.getSystemHealth() as { recentFailures?: unknown[] }).recentFailures ?? [] };
        break;
      case 'get_performance_report':
        data = this.getPerformanceReport();
        break;
      case 'compare_deployments':
        data = { supported: 'partial', currentCommit: this.git.currentCommit(), note: 'Deployment comparison needs a configured deployment history source.' };
        break;
      case 'analyze_site':
        data = this.analysis.analyzeSite(String(args.focus ?? 'overall'), String(args.depth ?? 'standard'));
        break;
      case 'find_improvement_opportunities':
        {
          const findings = this.analysis.findImprovementOpportunities({ category: String(args.category ?? ''), limit: Number(args.limit ?? 10) });
          data = {
            facts: findings.flatMap((finding) => (finding['evidence'] as unknown[] | undefined) ?? []).slice(0, 20),
            inferences: findings.map((finding) => finding['observedProblem']).slice(0, 10),
            recommendations: findings.map((finding) => finding['title']).slice(0, 10),
            findings
          };
        }
        break;
      case 'validate_proposed_change':
        data = this.analysis.validateProposedChange(String(args.proposal ?? ''));
        break;
      case 'validate_product_registry':
        data = validateProductRegistry(this.config.repoRoot);
        break;
      case 'prioritize_backlog':
        data = { items: this.analysis.findImprovementOpportunities({ limit: Number(args.limit ?? 10) }) };
        break;
      case 'generate_change_brief':
        data = { recentCommits: this.git.recentCommits(Number(args.limit ?? 10)), featureMatches: args.feature ? this.features.search(String(args.feature)) : [] };
        break;
      default:
        throw new Error(`Unknown GithubArchive+ MCP tool: ${name}`);
    }

    const dbState = this.db.state();
    warnings.push(...dbState.warnings);
    return {
      generated_at: nowIso(),
      source: {
        kind: inferSourceKind(name),
        repo_root: this.config.repoRoot,
        commit: this.git.currentCommit(),
        database_path: dbState.path,
        database_cutoff: dbState.cutoff,
        cached: false
      },
      confidence: dbState.available ? 0.9 : 0.72,
      warnings,
      data: redact(data)
    };
  }

  private getProductOverview(): Record<string, unknown> {
    const registry = this.features.read();
    return {
      purpose: 'GithubArchive+ preserves software evidence, then turns it into explainable repository intelligence.',
      majorUserFacingAreas: ['Homepage discovery signals', 'Birth Feed', 'Search', 'Repository pages', 'Emerging Topics', 'Websites', 'Admin operations'],
      architecture: readText(resolve(this.config.repoRoot, 'docs', 'ARCHITECTURE_PHILOSOPHY.md'), 12000),
      currentFeatureList: registry.features.map((feature) => ({ id: feature.id, name: feature.name, status: feature.status })),
      knownLimitations: [...new Set(registry.features.flatMap((feature) => feature.known_limitations))],
      activeDetectionVersions: {
        emergingTopics: registry.features.find((feature) => feature.id === 'emerging-topics')?.detection_version ?? null
      },
      latestDeployment: { sourceCommit: this.git.currentCommit(), deployedCommit: process.env.GITHUBARCHIVE_DEPLOYED_COMMIT ?? null },
      currentDatabaseCoverage: this.safeDb(() => this.db.getArchiveSummary())
    };
  }

  private getProjectState(): Record<string, unknown> {
    const archiveSummary = this.safeDb(() => this.db.getArchiveSummary()) as Record<string, unknown>;
    const latestDetectionRun = this.safeDb(() => this.db.listDetectionRuns(1)[0] ?? null);
    const materializations = this.safeDb(() => this.db.getMaterializationSummary());
    return {
      source: {
        commit: this.git.currentCommitFull(),
        shortCommit: this.git.currentCommit(),
        dirty: this.git.isDirty()
      },
      deployment: {
        commit: process.env.GITHUBARCHIVE_DEPLOYED_COMMIT ?? null,
        status: process.env.GITHUBARCHIVE_DEPLOYMENT_STATUS ?? 'unknown',
        productionUrl: this.config.productionBaseUrl
      },
      database: {
        asOf: this.db.state().cutoff,
        repositories: archiveSummary?.totalRepositories ?? null,
        enriched: archiveSummary?.enrichedRepositories ?? null,
        metricsSnapshots: archiveSummary?.metricsSnapshots ?? null,
        available: this.db.state().available
      },
      algorithms: {
        emergingDetectionVersion: this.features.get('emerging-topics')?.detection_version ?? null
      },
      runs: {
        latestEmergingDetection: latestDetectionRun
      },
      materializations: {
        homepage: materializations
      }
    };
  }

  private getFeatureDetail(id: string): Record<string, unknown> {
    const feature = this.features.get(id);
    if (!feature) return { found: false, query: id, similar: this.features.search(id).slice(0, 5) };
    return {
      found: true,
      feature,
      decisions: this.decisions.search(`${feature.name} ${feature.id}`).map(publicDecision),
      commits: this.git.commitsTouching([...feature.source, ...feature.tests], 20),
      sourceMatches: this.source.search(feature.id, 20)
    };
  }

  private async capturePageSnapshot(path: string): Promise<Record<string, unknown>> {
    const route = this.routes.inspectRoute(path);
    if (!this.config.productionBaseUrl) {
      return {
        path,
        route,
        renderedText: null,
        status: 'unavailable',
        warning: 'Set GITHUBARCHIVE_PRODUCTION_URL to capture deployed page text.'
      };
    }
    const url = new URL(path, this.config.productionBaseUrl).toString();
    const started = Date.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const html = (await response.text()).slice(0, 50000);
    return {
      path,
      url,
      status: response.status,
      loadMs: Date.now() - started,
      title: html.match(/<title>(.*?)<\/title>/i)?.[1] ?? null,
      renderedText: html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000),
      serverTiming: response.headers.get('server-timing'),
      route
    };
  }

  private inspectCoverage(): Record<string, unknown> {
    const routes = this.routes.listRoutes();
    const features = this.features.list();
    return {
      routesWithoutObviousTests: routes.filter((route) => !route.hasTests).map((route) => ({ path: route.path, files: route.files, featureIds: route.featureIds })),
      featuresWithoutTests: features.filter((feature) => feature.tests.length === 0).map((feature) => ({ id: feature.id, name: feature.name, source: feature.source })),
      unusedComponents: [],
      staleCompatibilityPaths: features.flatMap((feature) => feature.known_limitations.filter((limitation) => limitation.toLowerCase().includes('stale')).map((limitation) => ({ feature: feature.id, limitation })))
    };
  }

  private compareDetectionVersions(topic: string): Record<string, unknown> {
    const explanation = this.db.explainTopicDetection(topic);
    return {
      topic,
      activeVersion: 2,
      explanation,
      expectedV1Behavior: 'Raw repository and owner counts could inflate trends before independent evidence grouping.',
      expectedV2Behavior: 'Copied repositories are compressed into independent evidence groups; stale v1 rows are not served as current intelligence.'
    };
  }

  private explainRepositoryScore(repository: string): Record<string, unknown> {
    const inspected = this.db.inspectRepository(repository) as { repository?: Record<string, unknown>; snapshots?: unknown[]; metrics?: unknown[]; events?: unknown[] } | null;
    if (!inspected?.repository) return { found: false, repository };
    const repo = inspected.repository;
    return {
      found: true,
      repository: repo.full_name,
      score: repo.interesting_score ?? null,
      signalTier: repo.signal_tier ?? null,
      evidence: [
        { factor: 'stars', value: repo.stars ?? null, confidence: 'direct' },
        { factor: 'forks', value: repo.forks ?? null, confidence: 'direct' },
        { factor: 'category', value: repo.category ?? null, confidence: 'derived' },
        { factor: 'snapshots', value: inspected.snapshots?.length ?? 0, confidence: 'direct' },
        { factor: 'metricsHistory', value: inspected.metrics?.length ?? 0, confidence: 'direct' },
        { factor: 'events', value: inspected.events?.length ?? 0, confidence: 'direct' }
      ],
      warning: 'This tool explains persisted score evidence; exact scoring formula versioning is not yet persisted as a first-class IntelligenceResult.'
    };
  }

  private inspectCluster(cluster: string): Record<string, unknown> {
    return this.safeDb(() => this.db.queryRepositories({ cluster, limit: 25 }));
  }

  private inspectClassification(category: string): Record<string, unknown> {
    return this.safeDb(() => this.db.queryRepositories({ category, limit: 25 }));
  }

  private getPerformanceReport(): Record<string, unknown> {
    return {
      persistedRouteMetrics: false,
      availableEvidence: this.source.search('Server-Timing', 20),
      recommendation: 'Persist sampled route timings before reporting p50/p95 from MCP.'
    };
  }

  private safeDb<T>(fn: () => T): T | { available: false; warnings: string[] } {
    try {
      return fn();
    } catch (error) {
      return { available: false, warnings: [error instanceof Error ? error.message : String(error)] };
    }
  }
}

const TOOL_NAMES = [
  'get_project_state',
  'get_product_overview',
  'list_features',
  'get_feature_detail',
  'search_existing_capabilities',
  'search_product_decisions',
  'get_product_decision',
  'list_routes',
  'inspect_route',
  'inspect_navigation',
  'capture_page_snapshot',
  'compare_page_snapshots',
  'search_code',
  'get_symbol',
  'get_recent_commits',
  'explain_change_history',
  'find_uncovered_code',
  'inspect_test_coverage',
  'get_archive_summary',
  'query_repositories',
  'inspect_repository',
  'get_data_quality_report',
  'query_duplicate_families',
  'explain_repository_score',
  'explain_topic_detection',
  'compare_detection_versions',
  'list_detection_runs',
  'inspect_cluster',
  'inspect_classification',
  'get_system_health',
  'get_job_status',
  'verify_read_only_enforcement',
  'list_recent_failures',
  'get_performance_report',
  'compare_deployments',
  'analyze_site',
  'find_improvement_opportunities',
  'validate_proposed_change',
  'validate_product_registry',
  'prioritize_backlog',
  'generate_change_brief'
] as const;

const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_project_state: 'Return a compact canonical snapshot of source, deployment hints, database coverage, algorithms, latest runs, and materializations.',
  validate_product_registry: 'Validate product-registry references, statuses, commits, routes, tests, and active detection versions.',
  verify_read_only_enforcement: 'Attempt forbidden SQLite statements and report whether read-only MCP database protections block them.',
  validate_proposed_change: 'Search product evidence before deciding whether a proposed feature already exists.',
  get_product_overview: 'Summarize GithubArchive+ purpose, architecture, features, versions, deployment, and data coverage.',
  explain_topic_detection: 'Explain current or stale emerging-topic detection state without serving old versions as current intelligence.',
  search_existing_capabilities: 'Search registry, decisions, code, tests, and docs for an existing capability.'
};

function inferSourceKind(name: string): 'source' | 'database' | 'git' | 'runtime' | 'mixed' {
  if (name.includes('repository') || name.includes('archive') || name.includes('detection') || name.includes('job') || name.includes('health')) return 'database';
  if (name.includes('commit') || name.includes('change_history')) return 'git';
  if (name.includes('code') || name.includes('symbol') || name.includes('route') || name.includes('feature') || name.includes('decision')) return 'source';
  return 'mixed';
}

function publicDecision(decision: { id: string; title: string; path: string; sections?: Record<string, string> }): Record<string, unknown> {
  return { id: decision.id, title: decision.title, path: decision.path, sections: decision.sections ?? {} };
}

function readText(path: string, maxChars: number): string | null {
  try {
    return readFileSync(path, 'utf8').slice(0, maxChars);
  } catch {
    return null;
  }
}
