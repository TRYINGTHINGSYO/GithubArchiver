import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { normalize } from './feature-registry.js';

export interface ProductDecision {
  id: string;
  title: string;
  path: string;
  content: string;
  sections: Record<string, string>;
}

export class DecisionJournalService {
  constructor(private readonly repoRoot: string) {}

  list(): ProductDecision[] {
    const dir = resolve(this.repoRoot, 'docs', 'product', 'decisions');
    try {
      return readdirSync(dir)
        .filter((file) => file.endsWith('.md'))
        .sort()
        .map((file) => this.readByPath(join(dir, file)));
    } catch {
      return [];
    }
  }

  get(id: string): ProductDecision | null {
    const needle = normalize(id);
    return this.list().find((decision) => normalize(decision.id) === needle || normalize(decision.title) === needle) ?? null;
  }

  search(query: string): ProductDecision[] {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return this.list();
    return this.list()
      .map((decision) => {
        const haystack = normalize(`${decision.id} ${decision.title} ${decision.content}`);
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { decision, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.decision.id.localeCompare(b.decision.id))
      .map((row) => row.decision);
  }

  private readByPath(path: string): ProductDecision {
    if (!statSync(path).isFile()) throw new Error(`not a decision file: ${path}`);
    const content = readFileSync(path, 'utf8');
    const title = content.match(/^#\s+(.+)$/m)?.[1] ?? basename(path, '.md');
    return {
      id: basename(path, '.md'),
      title,
      path,
      content,
      sections: parseSections(content)
    };
  }
}

function parseSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = markdown.split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const [heading, ...body] = part.split(/\r?\n/);
    sections[heading.trim().toLowerCase()] = body.join('\n').trim();
  }
  return sections;
}
