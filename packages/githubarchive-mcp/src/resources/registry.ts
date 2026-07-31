import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DecisionJournalService } from '../services/decision-journal.js';

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export class GithubArchiveResources {
  constructor(private readonly repoRoot: string) {}

  list(): McpResource[] {
    const decisions = new DecisionJournalService(this.repoRoot).list();
    return [
      {
        uri: 'githubarchive://architecture/philosophy',
        name: 'Architecture Philosophy',
        description: 'Governing evidence-first architecture philosophy for GithubArchive+.',
        mimeType: 'text/markdown'
      },
      {
        uri: 'githubarchive://product/features',
        name: 'Feature Registry',
        description: 'Machine-readable inventory of implemented product capabilities.',
        mimeType: 'application/json'
      },
      {
        uri: 'githubarchive://schema/source',
        name: 'Database Schema Source',
        description: 'Application schema migration source.',
        mimeType: 'text/typescript'
      },
      ...decisions.map((decision) => ({
        uri: `githubarchive://product/decisions/${decision.id}`,
        name: decision.title,
        description: 'Product decision journal entry.',
        mimeType: 'text/markdown'
      }))
    ];
  }

  read(uri: string): { uri: string; mimeType: string; text: string } {
    if (uri === 'githubarchive://architecture/philosophy') {
      return this.readFile(uri, 'text/markdown', resolve(this.repoRoot, 'docs', 'ARCHITECTURE_PHILOSOPHY.md'));
    }
    if (uri === 'githubarchive://product/features') {
      return this.readFile(uri, 'application/json', resolve(this.repoRoot, 'docs', 'product', 'features.json'));
    }
    if (uri === 'githubarchive://schema/source') {
      return this.readFile(uri, 'text/typescript', resolve(this.repoRoot, 'src', 'lib', 'server', 'db', 'schema.ts'));
    }
    const match = uri.match(/^githubarchive:\/\/product\/decisions\/(.+)$/);
    if (match) {
      return this.readFile(uri, 'text/markdown', join(this.repoRoot, 'docs', 'product', 'decisions', `${match[1]}.md`));
    }
    throw new Error(`Unknown GithubArchive+ resource: ${uri}`);
  }

  private readFile(uri: string, mimeType: string, path: string): { uri: string; mimeType: string; text: string } {
    return { uri, mimeType, text: readFileSync(path, 'utf8') };
  }
}
