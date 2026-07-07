import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { ArchiveSnapshotRow } from '$lib/server/db';
import { resolveSafeSnapshotPath } from '$lib/server/snapshots';

export interface SourceFileEntry {
	path: string;
	name: string;
	extension: string;
	size: number;
	type: 'file' | 'directory';
}

export interface LanguageBreakdownItem {
	language: string;
	bytes: number;
	files: number;
	percent: number;
}

export interface SourceAnalysis {
	snapshot_id: number;
	available: boolean;
	file_count: number;
	folder_count: number;
	total_bytes: number;
	truncated: boolean;
	files: SourceFileEntry[];
	folders: string[];
	largest_files: SourceFileEntry[];
	language_breakdown: LanguageBreakdownItem[];
	signals: string[];
	security_files: string[];
	error: string | null;
}

const MAX_TAR_ENTRIES = 7000;
const MAX_FILES_RETURNED = 800;
const MAX_COMPRESSED_ANALYSIS_BYTES = Number(process.env.SOURCE_ANALYSIS_MAX_BYTES ?? 30_000_000);
const analysisCache = new Map<string, SourceAnalysis | null>();
const tarIndexCache = new Map<string, Map<string, { offset: number; size: number }>>();

export interface SourceTarIndexEntry {
	offset: number;
	size: number;
}

export function clearSourceTarIndexCache(snapshotId?: number): void {
	if (snapshotId === undefined) {
		tarIndexCache.clear();
		return;
	}
	for (const key of tarIndexCache.keys()) {
		if (key.startsWith(`${snapshotId}:`)) tarIndexCache.delete(key);
	}
}

const EXT_LANGUAGE: Record<string, string> = {
	'.js': 'JavaScript',
	'.jsx': 'JavaScript',
	'.ts': 'TypeScript',
	'.tsx': 'TypeScript',
	'.svelte': 'Svelte',
	'.vue': 'Vue',
	'.py': 'Python',
	'.rb': 'Ruby',
	'.go': 'Go',
	'.rs': 'Rust',
	'.java': 'Java',
	'.kt': 'Kotlin',
	'.kts': 'Kotlin',
	'.cs': 'C#',
	'.cpp': 'C++',
	'.cc': 'C++',
	'.cxx': 'C++',
	'.c': 'C',
	'.h': 'C/C++ Header',
	'.hpp': 'C++ Header',
	'.php': 'PHP',
	'.swift': 'Swift',
	'.dart': 'Dart',
	'.ex': 'Elixir',
	'.exs': 'Elixir',
	'.erl': 'Erlang',
	'.scala': 'Scala',
	'.clj': 'Clojure',
	'.html': 'HTML',
	'.css': 'CSS',
	'.scss': 'SCSS',
	'.json': 'JSON',
	'.yaml': 'YAML',
	'.yml': 'YAML',
	'.md': 'Markdown',
	'.sql': 'SQL',
	'.sh': 'Shell',
	'.ps1': 'PowerShell',
	'.bat': 'Batch',
	'.dockerfile': 'Dockerfile'
};

function octalSize(raw: Buffer): number {
	const text = raw.toString('utf8').replace(/\0.*$/, '').trim();
	return text ? Number.parseInt(text, 8) || 0 : 0;
}

function extensionFor(path: string): string {
	const lower = path.toLowerCase();
	if (lower.endsWith('dockerfile') || lower.includes('/dockerfile')) return '.dockerfile';
	const idx = lower.lastIndexOf('.');
	return idx >= 0 ? lower.slice(idx) : '';
}

function stripRoot(path: string): string {
	const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
	const parts = clean.split('/').filter(Boolean);
	if (parts.length <= 1) return parts[0] ?? '';
	return parts.slice(1).join('/');
}

function uniqueSorted(values: Iterable<string>, limit: number): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b)).slice(0, limit);
}

function detectSignals(paths: string[]): { signals: string[]; securityFiles: string[] } {
	const lower = new Set(paths.map((p) => p.toLowerCase()));
	const has = (name: string) => lower.has(name.toLowerCase());
	const hasEnding = (suffix: string) => [...lower].some((p) => p.endsWith(suffix.toLowerCase()));
	const hasPart = (part: string) => [...lower].some((p) => p.includes(part.toLowerCase()));
	const signals = new Set<string>();
	const securityFiles = new Set<string>();

	if (has('package.json')) signals.add('Node.js package');
	if (has('pnpm-lock.yaml')) signals.add('pnpm');
	if (has('yarn.lock')) signals.add('Yarn');
	if (has('package-lock.json')) signals.add('npm');
	if (has('vite.config.ts') || has('vite.config.js')) signals.add('Vite');
	if (has('svelte.config.js') || has('svelte.config.ts')) signals.add('SvelteKit/Svelte');
	if (has('next.config.js') || has('next.config.mjs') || has('next.config.ts')) signals.add('Next.js');
	if (has('astro.config.mjs') || has('astro.config.ts')) signals.add('Astro');
	if (has('pyproject.toml')) signals.add('Python package');
	if (has('requirements.txt')) signals.add('pip requirements');
	if (has('poetry.lock')) signals.add('Poetry');
	if (has('cargo.toml')) signals.add('Rust/Cargo');
	if (has('go.mod')) signals.add('Go modules');
	if (has('pom.xml')) signals.add('Maven');
	if (has('build.gradle') || has('build.gradle.kts')) signals.add('Gradle');
	if (has('dockerfile') || hasEnding('/dockerfile')) signals.add('Docker');
	if (has('docker-compose.yml') || has('docker-compose.yaml')) signals.add('Docker Compose');
	if (hasPart('.github/workflows/')) signals.add('GitHub Actions');
	if (hasPart('.gitlab-ci.yml')) signals.add('GitLab CI');
	if (hasPart('dependabot.yml') || hasPart('dependabot.yaml')) signals.add('Dependabot');

	for (const path of paths) {
		const normalized = path.toLowerCase();
		if (
			normalized.endsWith('security.md') ||
			normalized.endsWith('code_of_conduct.md') ||
			normalized.endsWith('contributing.md') ||
			normalized.includes('.github/issue_template') ||
			normalized.includes('pull_request_template')
		) {
			securityFiles.add(path);
		}
	}

	return {
		signals: [...signals].sort((a, b) => a.localeCompare(b)),
		securityFiles: [...securityFiles].sort((a, b) => a.localeCompare(b))
	};
}

function emptyAnalysis(snapshot: ArchiveSnapshotRow, error: string, truncated = false): SourceAnalysis {
	return {
		snapshot_id: snapshot.id,
		available: false,
		file_count: 0,
		folder_count: 0,
		total_bytes: 0,
		truncated,
		files: [],
		folders: [],
		largest_files: [],
		language_breakdown: [],
		signals: [],
		security_files: [],
		error
	};
}

function cacheKey(snapshot: ArchiveSnapshotRow): string {
	return `${snapshot.id}:${snapshot.sha256}:${snapshot.file_size}`;
}

export function clearSourceAnalysisCache(snapshotId?: number): void {
	if (snapshotId === undefined) {
		analysisCache.clear();
		clearSourceTarIndexCache();
		return;
	}
	for (const key of analysisCache.keys()) {
		if (key.startsWith(`${snapshotId}:`)) analysisCache.delete(key);
	}
	clearSourceTarIndexCache(snapshotId);
}

function loadGunzippedTar(snapshot: ArchiveSnapshotRow): { tar: Buffer; error: string | null } {
	let safePath: string;
	try {
		safePath = resolveSafeSnapshotPath(snapshot.file_path);
	} catch {
		return { tar: Buffer.alloc(0), error: 'Snapshot path could not be resolved safely.' };
	}
	if (!existsSync(safePath)) {
		return { tar: Buffer.alloc(0), error: 'Snapshot file is missing on disk.' };
	}
	if (snapshot.file_size > MAX_COMPRESSED_ANALYSIS_BYTES) {
		return {
			tar: Buffer.alloc(0),
			error: `Source archive exceeds analysis limit (${MAX_COMPRESSED_ANALYSIS_BYTES.toLocaleString()} bytes).`
		};
	}
	try {
		return { tar: gunzipSync(readFileSync(safePath)), error: null };
	} catch (err) {
		return { tar: Buffer.alloc(0), error: err instanceof Error ? err.message : String(err) };
	}
}

export function indexSourceTarball(
	snapshot: ArchiveSnapshotRow | null
): { index: Map<string, SourceTarIndexEntry>; error: string | null } {
	if (!snapshot || snapshot.snapshot_type !== 'source') {
		return { index: new Map(), error: 'No source snapshot.' };
	}
	const key = cacheKey(snapshot);
	const cached = tarIndexCache.get(key);
	if (cached) return { index: cached, error: null };

	const { tar, error } = loadGunzippedTar(snapshot);
	if (error) return { index: new Map(), error };

	const index = new Map<string, SourceTarIndexEntry>();
	let offset = 0;
	let entries = 0;

	while (offset + 512 <= tar.length && entries < MAX_TAR_ENTRIES) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((b) => b === 0)) break;

		const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
		const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
		const fullRawName = prefix ? `${prefix}/${rawName}` : rawName;
		const path = stripRoot(fullRawName).replace(/\/$/, '');
		const size = octalSize(header.subarray(124, 136));
		const typeflag = String.fromCharCode(header[156] || 48);
		const isDirectory = typeflag === '5' || fullRawName.endsWith('/');

		if (path && !isDirectory && size > 0) {
			index.set(path, { offset: offset + 512, size });
		}

		offset += 512 + Math.ceil(size / 512) * 512;
		entries++;
	}

	tarIndexCache.set(key, index);
	return { index, error: null };
}

const BINARY_EXTENSIONS = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.ico',
	'.pdf',
	'.zip',
	'.gz',
	'.tar',
	'.wasm',
	'.exe',
	'.dll',
	'.so',
	'.dylib',
	'.bin',
	'.mp3',
	'.mp4',
	'.woff',
	'.woff2',
	'.ttf',
	'.eot',
	'.otf',
	'.class',
	'.jar'
]);

export function isProbablyBinary(path: string, content: Buffer): boolean {
	const ext = extensionFor(path);
	if (BINARY_EXTENSIONS.has(ext)) return true;
	if (content.includes(0)) return true;
	return false;
}

export function readSourceFileFromSnapshot(
	snapshot: ArchiveSnapshotRow | null,
	filePath: string
): { content: Buffer | null; binary: boolean; error: string | null } {
	if (!snapshot || snapshot.snapshot_type !== 'source') {
		return { content: null, binary: false, error: 'No source snapshot.' };
	}
	const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
	const { index, error } = indexSourceTarball(snapshot);
	if (error) return { content: null, binary: false, error };

	const entry = index.get(normalized);
	if (!entry) return { content: null, binary: false, error: 'File not found in archive.' };

	const { tar, error: tarError } = loadGunzippedTar(snapshot);
	if (tarError) return { content: null, binary: false, error: tarError };

	const end = entry.offset + entry.size;
	if (end > tar.length) {
		return { content: null, binary: false, error: 'Archive index is out of range.' };
	}

	const content = tar.subarray(entry.offset, end);
	return { content, binary: isProbablyBinary(normalized, content), error: null };
}

export function analyzeSourceSnapshot(snapshot: ArchiveSnapshotRow | null): SourceAnalysis | null {
	if (!snapshot || snapshot.snapshot_type !== 'source') return null;
	const key = cacheKey(snapshot);
	if (analysisCache.has(key)) return analysisCache.get(key) ?? null;

	let tar: Buffer;
	try {
		const loaded = loadGunzippedTar(snapshot);
		if (loaded.error) {
			const result = emptyAnalysis(snapshot, loaded.error);
			analysisCache.set(key, result);
			return result;
		}
		tar = loaded.tar;
	} catch (err) {
		const result = emptyAnalysis(snapshot, err instanceof Error ? err.message : String(err));
		analysisCache.set(key, result);
		return result;
	}
	const files: SourceFileEntry[] = [];
	const folders = new Set<string>();
	let offset = 0;
	let entries = 0;
	let truncated = false;

	while (offset + 512 <= tar.length && entries < MAX_TAR_ENTRIES) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((b) => b === 0)) break;

		const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
		const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
		const fullRawName = prefix ? `${prefix}/${rawName}` : rawName;
		const path = stripRoot(fullRawName);
		const size = octalSize(header.subarray(124, 136));
		const typeflag = String.fromCharCode(header[156] || 48);
		const isDirectory = typeflag === '5' || path.endsWith('/');

		if (path) {
			const cleanPath = path.replace(/\/$/, '');
			const parts = cleanPath.split('/');
			for (let i = 1; i < parts.length; i++) {
				folders.add(parts.slice(0, i).join('/'));
			}
			if (isDirectory) {
				folders.add(cleanPath);
			} else {
				files.push({
					path: cleanPath,
					name: parts.at(-1) ?? cleanPath,
					extension: extensionFor(cleanPath),
					size,
					type: 'file'
				});
			}
		}

		offset += 512 + Math.ceil(size / 512) * 512;
		entries++;
	}

	if (entries >= MAX_TAR_ENTRIES) truncated = true;

	const languageMap = new Map<string, { bytes: number; files: number }>();
	for (const file of files) {
		const language = EXT_LANGUAGE[file.extension] ?? (file.extension ? file.extension.slice(1) : 'Other');
		const current = languageMap.get(language) ?? { bytes: 0, files: 0 };
		current.bytes += file.size;
		current.files += 1;
		languageMap.set(language, current);
	}

	const totalLanguageBytes = [...languageMap.values()].reduce((sum, item) => sum + item.bytes, 0);
	const language_breakdown = [...languageMap.entries()]
		.map(([language, item]) => ({
			language,
			bytes: item.bytes,
			files: item.files,
			percent: totalLanguageBytes > 0 ? Math.round((item.bytes / totalLanguageBytes) * 1000) / 10 : 0
		}))
		.sort((a, b) => b.bytes - a.bytes)
		.slice(0, 10);

	const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
	const { signals, securityFiles } = detectSignals(sortedFiles.map((f) => f.path));

	const result: SourceAnalysis = {
		snapshot_id: snapshot.id,
		available: true,
		file_count: files.length,
		folder_count: folders.size,
		total_bytes: files.reduce((sum, file) => sum + file.size, 0),
		truncated,
		files: sortedFiles.slice(0, MAX_FILES_RETURNED),
		folders: uniqueSorted(folders, 200),
		largest_files: [...files].sort((a, b) => b.size - a.size).slice(0, 12),
		language_breakdown,
		signals,
		security_files: securityFiles,
		error: truncated ? `Analysis stopped after ${MAX_TAR_ENTRIES.toLocaleString()} tar entries.` : null
	};
	analysisCache.set(key, result);
	return result;
}
