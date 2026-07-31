import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FeatureRegistryService } from './feature-registry.js';
import { SourceIndexService } from './source-index.js';

export interface RouteInfo {
  path: string;
  kind: 'public' | 'admin' | 'api' | 'system';
  purpose: string;
  auth: 'public' | 'admin' | 'unknown';
  files: string[];
  inNavigation: boolean;
  hasTests: boolean;
  featureIds: string[];
}

export class RouteInspectorService {
  constructor(
    private readonly repoRoot: string,
    private readonly source: SourceIndexService,
    private readonly features: FeatureRegistryService
  ) {}

  listRoutes(): RouteInfo[] {
    const routes = new Map<string, string[]>();
    for (const file of this.source.routeFiles()) {
      const path = routePathFromFile(file);
      routes.set(path, [...(routes.get(path) ?? []), file]);
    }
    const featureList = this.features.list();
    const tests = this.source.testFiles().join(' ');
    const navText = this.source.readRelative('src/routes/+layout.svelte', 50000) ?? '';
    return [...routes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, files]) => {
        const kind = path.startsWith('/api') ? 'api' : path.startsWith('/admin') ? 'admin' : path === '/robots.txt' || path === '/sitemap.xml' ? 'system' : 'public';
        const featureIds = featureList.filter((feature) => feature.routes.includes(path) || feature.routes.some((route) => routeMatches(route, path))).map((feature) => feature.id);
        return {
          path,
          kind,
          purpose: inferPurpose(path, featureIds),
          auth: kind === 'admin' ? 'admin' : 'public',
          files,
          inNavigation: navText.includes(`href="${path}"`) || navText.includes(`href='${path}'`) || path === '/',
          hasTests: files.some((file) => tests.includes(file.split('/').slice(-2, -1)[0] ?? '')) || featureList.some((feature) => feature.routes.includes(path) && feature.tests.length > 0),
          featureIds
        };
      });
  }

  inspectRoute(path: string): RouteInfo & { title: string | null; sections: string[]; links: string[]; visibleMetrics: Record<string, unknown>; warnings: string[] } {
    const route = this.listRoutes().find((row) => row.path === path) ?? {
      path,
      kind: path.startsWith('/api') ? 'api' as const : 'public' as const,
      purpose: 'Unknown route',
      auth: 'unknown' as const,
      files: [],
      inNavigation: false,
      hasTests: false,
      featureIds: []
    };
    const svelteFile = route.files.find((file) => file.endsWith('.svelte'));
    const content = svelteFile ? readIfExists(resolve(this.repoRoot, svelteFile)) : '';
    const title = content.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
    const sections = [...content.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) => stripSvelte(m[1]).trim()).filter(Boolean);
    const links = [...content.matchAll(/href=\{?["']([^"'}]+)["']\}?/g)].map((m) => m[1]).slice(0, 100);
    const warnings: string[] = [];
    if (route.files.length === 0) warnings.push('No local route file found for this path.');
    if (!route.inNavigation && route.kind === 'public') warnings.push('Public route does not appear in global navigation.');
    if (!route.hasTests) warnings.push('No obvious route or feature test coverage found.');
    return { ...route, title, sections, links, visibleMetrics: {}, warnings };
  }

  inspectNavigation(): { routesMissingFromNavigation: string[]; orphanedPublicRoutes: string[]; deadLinks: string[]; duplicateDestinations: string[] } {
    const routes = this.listRoutes();
    const publicRoutes = routes.filter((route) => route.kind === 'public');
    const routesMissingFromNavigation = publicRoutes.filter((route) => !route.inNavigation).map((route) => route.path);
    const layout = this.source.readRelative('src/routes/+layout.svelte', 50000) ?? '';
    const links = [...layout.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]).filter((href) => href.startsWith('/'));
    const routeSet = new Set(routes.map((route) => route.path));
    const deadLinks = links.filter((href) => !routeSet.has(href) && !href.includes('['));
    const duplicateDestinations = links.filter((href, index) => links.indexOf(href) !== index);
    return { routesMissingFromNavigation, orphanedPublicRoutes: routesMissingFromNavigation, deadLinks, duplicateDestinations };
  }
}

function routePathFromFile(file: string): string {
  let dir = file.replace(/^src\/routes/, '').replace(/\/\+[^/]+$/, '');
  dir = dir.replace(/\[([^\]]+)\]/g, '[$1]');
  return dir || '/';
}

function inferPurpose(path: string, featureIds: string[]): string {
  if (featureIds.length) return `Supports ${featureIds.join(', ')}`;
  if (path.startsWith('/api')) return 'API endpoint';
  if (path.startsWith('/admin')) return 'Administrative operations';
  return 'Application page';
}

function routeMatches(pattern: string, path: string): boolean {
  const regex = `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\[([^\\]+)\\\]/g, '[^/]+')}$`;
  return new RegExp(regex).test(path);
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function stripSvelte(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ');
}
