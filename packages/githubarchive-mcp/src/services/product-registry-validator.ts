import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FeatureRegistryService, type FeatureEntry } from './feature-registry.js';
import { RouteInspectorService } from './route-inspector.js';
import { SourceIndexService } from './source-index.js';

export interface ProductRegistryValidationIssue {
  level: 'error' | 'warning';
  featureId?: string;
  field?: string;
  message: string;
}

export interface ProductRegistryValidationResult {
  valid: boolean;
  errors: ProductRegistryValidationIssue[];
  warnings: ProductRegistryValidationIssue[];
  checked: {
    features: number;
    routes: number;
    sourceFiles: number;
    testFiles: number;
    detectionVersion: number | null;
  };
}

const VALID_STATUSES = new Set(['production', 'beta', 'planned', 'experimental', 'deprecated']);
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;

export function validateProductRegistry(repoRoot: string): ProductRegistryValidationResult {
  const issues: ProductRegistryValidationIssue[] = [];
  const source = new SourceIndexService(repoRoot);
  const features = new FeatureRegistryService(repoRoot);
  const routes = new RouteInspectorService(repoRoot, source, features);
  const registry = features.read();
  const routeSet = new Set(routes.listRoutes().map((route) => route.path));
  const detectionVersion = readCurrentEmergingDetectionVersion(repoRoot);

  const seenIds = new Set<string>();
  let checkedSourceFiles = 0;
  let checkedTestFiles = 0;

  for (const feature of registry.features) {
    if (seenIds.has(feature.id)) {
      issues.push(error(feature, 'id', `Duplicate feature id "${feature.id}".`));
    }
    seenIds.add(feature.id);

    if (!VALID_STATUSES.has(feature.status)) {
      issues.push(error(feature, 'status', `Invalid status "${feature.status}".`));
    }

    if (!feature.last_changed_commit) {
      issues.push(warning(feature, 'last_changed_commit', 'Missing last_changed_commit; registry consumers should treat recency as unknown.'));
    } else if (!COMMIT_RE.test(feature.last_changed_commit)) {
      issues.push(error(feature, 'last_changed_commit', `Invalid commit hash "${feature.last_changed_commit}".`));
    }
    if (feature.introduced_commit && !COMMIT_RE.test(feature.introduced_commit)) {
      issues.push(error(feature, 'introduced_commit', `Invalid commit hash "${feature.introduced_commit}".`));
    }

    for (const file of feature.source) {
      checkedSourceFiles++;
      if (!existsSync(resolve(repoRoot, file))) {
        issues.push(error(feature, 'source', `Referenced source file does not exist: ${file}`));
      }
    }

    for (const file of feature.tests) {
      checkedTestFiles++;
      if (!existsSync(resolve(repoRoot, file))) {
        issues.push(error(feature, 'tests', `Referenced test file does not exist: ${file}`));
      }
    }

    for (const route of feature.routes) {
      if (route === 'global layout') continue;
      if (!routeSet.has(route) && !matchesKnownRoutePattern(route, routeSet)) {
        issues.push(error(feature, 'routes', `Referenced route does not exist: ${route}`));
      }
    }

    if (feature.detection_version != null && detectionVersion != null && feature.detection_version !== detectionVersion) {
      issues.push(
        error(
          feature,
          'detection_version',
          `Feature registry detection_version ${feature.detection_version} does not match CURRENT_EMERGING_DETECTION_VERSION ${detectionVersion}.`
        )
      );
    }
  }

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checked: {
      features: registry.features.length,
      routes: routeSet.size,
      sourceFiles: checkedSourceFiles,
      testFiles: checkedTestFiles,
      detectionVersion
    }
  };
}

function readCurrentEmergingDetectionVersion(repoRoot: string): number | null {
  const file = resolve(repoRoot, 'src', 'lib', 'server', 'emerging-topics.ts');
  if (!existsSync(file)) return null;
  const match = readFileSync(file, 'utf8').match(/CURRENT_EMERGING_DETECTION_VERSION\s*=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function matchesKnownRoutePattern(pattern: string, routeSet: Set<string>): boolean {
  if (!pattern.includes('[')) return false;
  const regex = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\[([^\\]+)\\\]/g, '[^/]+')}$`);
  return [...routeSet].some((route) => regex.test(route));
}

function error(feature: FeatureEntry, field: string, message: string): ProductRegistryValidationIssue {
  return { level: 'error', featureId: feature.id, field, message };
}

function warning(feature: FeatureEntry, field: string, message: string): ProductRegistryValidationIssue {
  return { level: 'warning', featureId: feature.id, field, message };
}
