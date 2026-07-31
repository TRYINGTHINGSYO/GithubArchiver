import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface FeatureEntry {
  id: string;
  name: string;
  description: string;
  status: string;
  routes: string[];
  source: string[];
  tests: string[];
  tables: string[];
  introduced_commit: string | null;
  last_changed_commit: string | null;
  dependencies: string[];
  detection_version?: number;
  known_limitations: string[];
  follow_up_work: string[];
}

export interface FeatureRegistry {
  version: number;
  generated_at: string;
  features: FeatureEntry[];
}

export class FeatureRegistryService {
  constructor(private readonly repoRoot: string) {}

  read(): FeatureRegistry {
    const path = resolve(this.repoRoot, 'docs', 'product', 'features.json');
    return JSON.parse(readFileSync(path, 'utf8')) as FeatureRegistry;
  }

  list(): FeatureEntry[] {
    return this.read().features;
  }

  get(idOrName: string): FeatureEntry | null {
    const needle = normalize(idOrName);
    return (
      this.list().find(
        (feature) => normalize(feature.id) === needle || normalize(feature.name) === needle
      ) ?? null
    );
  }

  search(query: string): FeatureEntry[] {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return this.list();
    return this.list()
      .map((feature) => {
        const haystack = normalize(
          [
            feature.id,
            feature.name,
            feature.description,
            feature.status,
            feature.routes.join(' '),
            feature.source.join(' '),
            feature.tests.join(' '),
            feature.tables.join(' '),
            feature.dependencies.join(' '),
            feature.known_limitations.join(' '),
            feature.follow_up_work.join(' ')
          ].join(' ')
        );
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { feature, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.feature.id.localeCompare(b.feature.id))
      .map((row) => row.feature);
  }
}

export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
