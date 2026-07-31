import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { normalize } from './feature-registry.js';

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.svelte',
  '.js',
  '.json',
  '.md',
  '.sql',
  '.toml',
  '.yml',
  '.yaml',
  '.css'
]);

export interface CodeMatch {
  file: string;
  line: number;
  text: string;
}

export class SourceIndexService {
  constructor(private readonly repoRoot: string) {}

  search(query: string, limit = 50): CodeMatch[] {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const matches: CodeMatch[] = [];
    for (const file of this.textFiles()) {
      const abs = resolve(this.repoRoot, file);
      const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const haystack = normalize(lines[i]);
        if (terms.every((term) => haystack.includes(term)) || lines[i].includes(query)) {
          matches.push({ file, line: i + 1, text: lines[i].trim().slice(0, 500) });
          if (matches.length >= limit) return matches;
        }
      }
    }
    return matches;
  }

  getSymbol(symbol: string, limit = 50): { definition: CodeMatch | null; references: CodeMatch[] } {
    const matches = this.search(symbol, limit);
    const definition =
      matches.find((match) =>
        new RegExp(`\\b(function|class|interface|type|const|let|var)\\s+${escapeRegex(symbol)}\\b`).test(match.text)
      ) ?? null;
    return { definition, references: matches };
  }

  routeFiles(): string[] {
    const routesDir = resolve(this.repoRoot, 'src', 'routes');
    if (!existsSync(routesDir)) return [];
    return this.walk(routesDir)
      .filter((file) => /[+](page|server|layout)\.(svelte|ts)$/.test(file))
      .map((file) => relative(this.repoRoot, file).replace(/\\/g, '/'))
      .sort();
  }

  testFiles(): string[] {
    const testsDir = resolve(this.repoRoot, 'tests');
    if (!existsSync(testsDir)) return [];
    return this.walk(testsDir)
      .filter((file) => file.endsWith('.test.ts'))
      .map((file) => relative(this.repoRoot, file).replace(/\\/g, '/'))
      .sort();
  }

  textFiles(): string[] {
    return this.walk(this.repoRoot)
      .filter((file) => {
        const rel = relative(this.repoRoot, file).replace(/\\/g, '/');
        if (rel.startsWith('.git/') || rel.startsWith('node_modules/') || rel.startsWith('.svelte-kit/') || rel.startsWith('build/')) return false;
        return TEXT_EXTENSIONS.has(extname(file));
      })
      .map((file) => relative(this.repoRoot, file).replace(/\\/g, '/'))
      .sort();
  }

  readRelative(path: string, maxChars = 20000): string | null {
    if (!path || isAbsolute(path)) return null;
    const normalizedInput = path.replace(/\\/g, '/');
    const segments = normalizedInput.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '..' || BLOCKED_PATH_SEGMENTS.has(segment))) return null;

    const abs = resolve(this.repoRoot, normalizedInput);
    if (!existsSync(abs) || !statSync(abs).isFile()) return null;

    const root = realpathSync(this.repoRoot);
    const target = realpathSync(abs);
    const rel = relative(root, target);
    if (rel === '' || rel.startsWith('..') || rel.includes(`${sep}..${sep}`) || isAbsolute(rel)) return null;
    if (rel.split(/[\\/]+/).some((segment) => BLOCKED_PATH_SEGMENTS.has(segment))) return null;
    return readFileSync(target, 'utf8').slice(0, maxChars);
  }

  private walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', '.svelte-kit', 'build'].includes(entry.name)) continue;
        out.push(...this.walk(full));
      } else {
        out.push(full);
      }
    }
    return out;
  }
}

const BLOCKED_PATH_SEGMENTS = new Set(['.git', 'node_modules', '.svelte-kit', 'build']);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
