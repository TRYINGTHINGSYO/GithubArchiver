export interface EvidenceItem {
  type: 'feature' | 'file' | 'test' | 'commit' | 'decision' | 'route' | 'table' | 'database' | 'warning';
  id?: string;
  title: string;
  location?: string;
  snippet?: string;
}

export interface ToolEnvelope<T> {
  generated_at: string;
  source: {
    kind: 'source' | 'database' | 'git' | 'runtime' | 'mixed';
    repo_root: string;
    commit?: string | null;
    database_path?: string | null;
    database_cutoff?: string | null;
    cached?: boolean;
  };
  confidence: number;
  warnings: string[];
  data: T;
}

export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
  total?: number;
  next_offset?: number | null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function nowIso(): string {
  return new Date().toISOString();
}
