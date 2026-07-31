import type { EvidenceItem } from '../schemas/common.js';
import { AppDatabaseService } from './app-database.js';
import type { FeatureEntry } from './feature-registry.js';
import { FeatureRegistryService, normalize } from './feature-registry.js';
import { DecisionJournalService } from './decision-journal.js';
import { GitService } from './git-service.js';
import { RouteInspectorService } from './route-inspector.js';
import { SourceIndexService } from './source-index.js';

export class AnalysisService {
  constructor(
    private readonly features: FeatureRegistryService,
    private readonly decisions: DecisionJournalService,
    private readonly source: SourceIndexService,
    private readonly git: GitService,
    private readonly routes: RouteInspectorService,
    private readonly db: AppDatabaseService
  ) {}

  searchExistingCapabilities(query: string): { matches: EvidenceItem[]; likelyImplemented: boolean; confidence: number; warnings: string[] } {
    const featureMatches = this.features.search(query).slice(0, 10);
    const decisionMatches = this.decisions.search(query).slice(0, 5);
    const codeMatches = this.source.search(query, 20);
    const matches: EvidenceItem[] = [
      ...featureMatches.map((feature) => ({
        type: 'feature' as const,
        id: feature.id,
        title: feature.name,
        snippet: feature.description,
        location: 'docs/product/features.json'
      })),
      ...decisionMatches.map((decision) => ({
        type: 'decision' as const,
        id: decision.id,
        title: decision.title,
        location: decision.path
      })),
      ...codeMatches.map((match) => ({
        type: match.file.includes('tests/') ? 'test' as const : 'file' as const,
        title: `${match.file}:${match.line}`,
        location: `${match.file}:${match.line}`,
        snippet: match.text
      }))
    ];
    const likelyImplemented = featureMatches.some((feature) => feature.status === 'production') || codeMatches.some((match) => match.file.startsWith('src/'));
    return {
      matches,
      likelyImplemented,
      confidence: likelyImplemented ? Math.min(0.95, 0.55 + featureMatches.length * 0.12 + codeMatches.length * 0.01) : 0.45,
      warnings: matches.length === 0 ? ['No matching feature, decision, or source evidence was found.'] : []
    };
  }

  validateProposedChange(proposal: string): Record<string, unknown> {
    const exactSignals = deriveProposalSignals(proposal);
    const rawFeatureMatches = uniqueFeatures([
      ...this.features.search(proposal),
      ...exactSignals.flatMap((signal) => this.features.search(signal))
    ]);
    const featureMatches = narrowProposalFeatures(proposal, rawFeatureMatches).slice(0, 12);
    const decisionMatches = uniqueById([
      ...this.decisions.search(proposal),
      ...exactSignals.flatMap((signal) => this.decisions.search(signal))
    ]).slice(0, 8);
    const codeMatches = [
      ...this.source.search(proposal, 20),
      ...exactSignals.flatMap((signal) => this.source.search(signal, 10))
    ].slice(0, 40);
    const productionFeatures = featureMatches.filter((feature) => feature.status === 'production');
    const alreadyImplemented = productionFeatures.length > 0;
    const facts = [
      ...productionFeatures.map((feature) => ({
        type: 'feature',
        id: feature.id,
        status: feature.status,
        statement: `${feature.name} is recorded as a production feature.`
      })),
      ...decisionMatches.map((decision) => ({
        type: 'decision',
        id: decision.id,
        statement: `Decision journal entry exists: ${decision.title}.`
      })),
      ...codeMatches
        .filter((match) => match.file.startsWith('src/') || match.file.startsWith('tests/'))
        .slice(0, 12)
        .map((match) => ({
          type: match.file.startsWith('tests/') ? 'test' : 'source',
          location: `${match.file}:${match.line}`,
          statement: match.text
        }))
    ];
    const inferences = alreadyImplemented
      ? ['The proposal overlaps with existing production capabilities and should be treated as follow-up work, not a greenfield feature.']
      : featureMatches.length || codeMatches.length
        ? ['Related evidence exists, but no matching production feature-registry entry proves the capability is complete.']
        : ['No registry, decision, or source evidence matched strongly enough to prove this capability exists.'];
    const recommendations = alreadyImplemented
      ? ['Do not rebuild the same feature. Work on the remaining documented gaps instead.']
      : ['Validate source matches manually before planning implementation.'];
    const evidence = {
      features: productionFeatures.map((feature) => feature.id),
      files: [...new Set(codeMatches.filter((match) => match.file.startsWith('src/')).map((match) => match.file))].slice(0, 20),
      tests: [...new Set(codeMatches.filter((match) => match.file.startsWith('tests/')).map((match) => match.file))].slice(0, 20),
      decisions: decisionMatches.map((decision) => decision.id),
      commits: [...new Set(featureMatches.flatMap((feature) => [feature.introduced_commit, feature.last_changed_commit].filter(Boolean) as string[]))],
      detectionVersion: featureMatches.find((feature) => feature.detection_version != null)?.detection_version ?? null
    };
    return {
      proposal,
      alreadyImplemented,
      status: alreadyImplemented ? 'production' : featureMatches.length ? 'partially-present' : 'not-found',
      confidence: alreadyImplemented ? 0.92 : featureMatches.length || codeMatches.length ? 0.68 : 0.42,
      facts,
      inferences,
      recommendations,
      evidence,
      matchedFeatures: featureMatches,
      matchedDecisions: decisionMatches.map((decision) => ({ id: decision.id, title: decision.title, path: decision.path })),
      remainingGaps: alreadyImplemented
        ? [...new Set(productionFeatures.flatMap((feature) => feature.follow_up_work))]
        : ['No production feature-registry entry matched this proposal. Inspect source matches before assuming it is absent.'],
      recommendation: alreadyImplemented
        ? 'Do not rebuild the same feature. Work on the remaining gaps instead.'
        : 'No completed capability was found in the registry; validate source matches before planning implementation.'
    };
  }

  analyzeSite(focus = 'overall', depth = 'standard'): Record<string, unknown> {
    const started = Date.now();
    const allRoutes = this.routes.listRoutes();
    const routes = allRoutes.slice(0, ANALYSIS_BUDGET.maxRoutes);
    const nav = this.routes.inspectNavigation();
    const features = this.features.list();
    const dbState = this.db.state();
    const findings = this.findImprovementOpportunities({ category: focus, limit: depth === 'deep' ? 10 : 5 });
    const recentCommits = this.git.recentCommits(ANALYSIS_BUDGET.maxGitCommits);
    const incomplete = allRoutes.length > routes.length;
    const facts = [
      `Feature registry contains ${features.length} features, including ${features.filter((feature) => feature.status === 'production').length} production features.`,
      `Route inspector found ${allRoutes.length} routes.`,
      `Database availability is ${dbState.available ? 'available' : 'unavailable'}.`
    ];
    const inferences = [
      incomplete
        ? 'Route analysis is partial because the configured route budget was reached.'
        : 'Route analysis completed within the configured budget.',
      findings.length
        ? 'The highest-impact next work should improve existing surfaces rather than duplicate recorded capabilities.'
        : 'No high-confidence missing capability was found from the bounded analysis pass.'
    ];
    const recommendations = findings.map((finding) => String(finding.title)).slice(0, 5);
    return {
      focus,
      depth,
      facts,
      inferences,
      recommendations,
      budgets: {
        ...ANALYSIS_BUDGET,
        elapsedMs: Date.now() - started,
        routesInspected: routes.length,
        totalRoutes: allRoutes.length
      },
      incomplete,
      product: {
        mission: 'GithubArchive+ preserves software evidence, then turns it into explainable repository intelligence.',
        featureCount: features.length,
        productionFeatureCount: features.filter((feature) => feature.status === 'production').length,
        routeCount: allRoutes.length
      },
      routeHealth: {
        publicRoutes: routes.filter((route) => route.kind === 'public').length,
        adminRoutes: routes.filter((route) => route.kind === 'admin').length,
        apiRoutes: routes.filter((route) => route.kind === 'api').length,
        routesMissingFromNavigation: nav.routesMissingFromNavigation,
        routesWithoutObviousTests: routes.filter((route) => !route.hasTests).map((route) => route.path)
      },
      database: dbState,
      recentCommits,
      findings
    };
  }

  findImprovementOpportunities(opts: { category?: string; limit?: number } = {}): Record<string, unknown>[] {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
    const features = this.features.list();
    const routes = this.routes.listRoutes();
    const findings: Record<string, unknown>[] = [];
    const untestedRoutes = routes.filter((route) => !route.hasTests && route.kind !== 'system').slice(0, 8);
    if (untestedRoutes.length) {
      findings.push({
        category: 'testing',
        title: 'Add route smoke coverage for untested surfaces',
        observedProblem: 'Some routes have no obvious test association.',
        evidence: untestedRoutes.map((route) => ({ type: 'route', title: route.path, location: route.files.join(', ') })),
        affectedRoutes: untestedRoutes.map((route) => route.path),
        alreadyImplemented: false,
        userImpact: 'Regressions can reach users without a fast failing test.',
        severity: 'medium',
        estimatedEffort: 'medium',
        proposedSolution: 'Add route-level load/render smoke tests for the highest-traffic public routes first.',
        validationPlan: 'Run npm test and confirm the route appears as tested in list_routes.'
      });
    }
    const gaps = features.flatMap((feature) =>
      feature.follow_up_work.map((work) => ({
        category: 'product',
        title: work,
        observedProblem: `${feature.name} has documented follow-up work.`,
        evidence: [{ type: 'feature', id: feature.id, title: feature.name, location: 'docs/product/features.json', snippet: work }],
        affectedRoutes: feature.routes,
        alreadyImplemented: false,
        userImpact: 'Improves an already-used capability instead of duplicating existing work.',
        severity: feature.id.includes('emerging') ? 'high' : 'medium',
        estimatedEffort: 'medium',
        proposedSolution: work,
        validationPlan: `Update ${feature.id} tests and feature registry after implementation.`
      }))
    );
    findings.push(...gaps);
    const dbState = this.db.state();
    if (!dbState.available) {
      findings.push({
        category: 'operations',
        title: 'Configure a readable production or local database for MCP analysis',
        observedProblem: 'The MCP server can inspect source state but not archive coverage.',
        evidence: dbState.warnings.map((warning) => ({ type: 'warning', title: warning })),
        affectedRoutes: [],
        alreadyImplemented: false,
        userImpact: 'AI analysis cannot distinguish source capabilities from actual collected data.',
        severity: 'high',
        estimatedEffort: 'low',
        proposedSolution: 'Set DATABASE_PATH for local analysis or a read replica path for production analysis.',
        validationPlan: 'Run get_archive_summary and confirm database_cutoff is populated.'
      });
    }
    return findings.slice(0, limit);
  }

  explainChangeHistory(featureId: string, limit = 20): Record<string, unknown> {
    const feature = this.features.get(featureId);
    if (!feature) return { feature: featureId, found: false, commits: [], narrative: [] };
    const commits = this.git.commitsTouching([...feature.source, ...feature.tests], limit);
    return {
      feature: feature.id,
      found: true,
      summary: feature.description,
      commits,
      narrative: commits.map((commit) => `${commit.hash}: ${commit.subject}`),
      knownLimitations: feature.known_limitations,
      followUpWork: feature.follow_up_work
    };
  }
}

const ANALYSIS_BUDGET = {
  maxRoutes: 80,
  maxDatabaseRows: 100,
  maxSourceMatches: 40,
  maxGitCommits: 10,
  maxFindings: 10,
  maxExecutionMs: 5000
};

function deriveProposalSignals(proposal: string): string[] {
  const normalized = normalize(proposal);
  const signals = new Set<string>();
  if (normalized.includes('duplicate') || normalized.includes('copied') || normalized.includes('forked') || normalized.includes('template')) {
    signals.add('emerging topic evidence deduplication');
    signals.add('duplicate evidence families');
    signals.add('independent evidence grouping');
    signals.add('stale detection version filtering');
  }
  if (normalized.includes('watch')) signals.add('watchlists');
  if (normalized.includes('evidence')) signals.add('evidence first');
  if (normalized.includes('search') || normalized.includes('export')) signals.add('dedicated search TSV export');
  signals.add(proposal);
  return [...signals];
}

function uniqueFeatures(features: FeatureEntry[]): FeatureEntry[] {
  const seen = new Set<string>();
  return features.filter((feature) => {
    if (seen.has(feature.id)) return false;
    seen.add(feature.id);
    return true;
  });
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function narrowProposalFeatures(proposal: string, features: FeatureEntry[]): FeatureEntry[] {
  const normalized = normalize(proposal);
  if (
    normalized.includes('duplicate') ||
    normalized.includes('copied') ||
    normalized.includes('forked') ||
    normalized.includes('template') ||
    normalized.includes('independent repository evidence')
  ) {
    const priority = [
      'emerging-topic-evidence-dedupe',
      'emerging-topics',
      'stale-detection-version-filtering',
      'stale-topic-recomputation-page'
    ];
    const selected = features.filter((feature) => priority.includes(feature.id));
    return selected.sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));
  }
  return features;
}
