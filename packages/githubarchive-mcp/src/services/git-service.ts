import { execFileSync } from 'node:child_process';

export interface CommitSummary {
  hash: string;
  subject: string;
  date: string;
  files?: string[];
}

export class GitService {
  constructor(private readonly repoRoot: string) {}

  currentCommit(): string | null {
    return this.git(['rev-parse', '--short', 'HEAD']).trim() || null;
  }

  currentCommitFull(): string | null {
    return this.git(['rev-parse', 'HEAD']).trim() || null;
  }

  isDirty(): boolean {
    return this.git(['status', '--porcelain']).trim().length > 0;
  }

  recentCommits(limit = 10): CommitSummary[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const output = this.git(['log', `-${safeLimit}`, '--date=iso-strict', '--pretty=format:%h%x09%ad%x09%s']);
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, date, ...subject] = line.split('\t');
        return { hash, date, subject: subject.join('\t') };
      });
  }

  commitsTouching(paths: string[], limit = 20): CommitSummary[] {
    if (paths.length === 0) return [];
    const output = this.git([
      'log',
      `-${Math.min(Math.max(Math.trunc(limit), 1), 50)}`,
      '--date=iso-strict',
      '--pretty=format:%h%x09%ad%x09%s',
      '--',
      ...paths
    ]);
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, date, ...subject] = line.split('\t');
        return { hash, date, subject: subject.join('\t') };
      });
  }

  private git(args: string[]): string {
    try {
      return execFileSync('git', args, {
        cwd: this.repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000
      });
    } catch {
      return '';
    }
  }
}
