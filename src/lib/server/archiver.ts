import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	getLatestReadmeSha256,
	getLatestSourceHeadSha,
	indexRepoFtsById,
	insertArchiveSnapshot,
	type RepoRow
} from '$lib/server/db';
import { appendRepoEvent } from '$lib/server/events';
import { handleRepoNotFound } from '$lib/server/enrich';
import {
	createZipSnapshotForSource,
	ensureZipForLatestSource
} from '$lib/server/source-zip';
import {
	DownloadTooLargeError,
	DownloadTimeoutError,
	fetchBranchHeadSha,
	fetchReadme,
	downloadSourceTarball,
	GitHubNotFoundError,
	GitHubRateLimitError
} from '$lib/server/github';

export interface ArchiveConfig {
	archiveDir: string;
	maxBytes: number;
	timeoutMs: number;
	createZipSnapshot: boolean;
}

export interface ArchiveRepoResult {
	repo: string;
	readme: 'saved' | 'skipped' | 'missing';
	source: 'saved' | 'skipped' | 'missing' | 'too_large' | 'timeout';
	zip: 'saved' | 'skipped' | 'missing';
	error?: string;
}

function sha256(data: Buffer | string): string {
	return createHash('sha256').update(data).digest('hex');
}

function snapshotTimestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

function repoArchiveDir(config: ArchiveConfig, owner: string, name: string): string {
	const dir = join(config.archiveDir, owner, name);
	mkdirSync(dir, { recursive: true });
	return dir;
}

export async function archiveRepo(
	repo: RepoRow,
	config: ArchiveConfig,
	opts: { captureReason?: string } = {}
): Promise<ArchiveRepoResult> {
	const captureReason = opts.captureReason ?? 'daemon';
	const result: ArchiveRepoResult = {
		repo: repo.full_name,
		readme: 'missing',
		source: 'missing',
		zip: 'missing'
	};

	const branch = repo.default_branch;
	if (!branch) {
		result.error = 'no default branch';
		return result;
	}

	const dir = repoArchiveDir(config, repo.owner, repo.name);
	const archivedAt = new Date().toISOString();
	const ts = snapshotTimestamp();

	// README snapshot
	try {
		const readme = await fetchReadme(repo.owner, repo.name);
		if (readme) {
			const hash = sha256(readme);
			const latestReadmeHash = getLatestReadmeSha256(repo.id);
			if (latestReadmeHash === hash) {
				result.readme = 'skipped';
			} else {
				const readmePath = join(dir, `${ts}-README.md`);
				writeFileSync(readmePath, readme, 'utf8');
				const buf = Buffer.from(readme, 'utf8');
				const snapshotId = insertArchiveSnapshot({
					repo_id: repo.id,
					snapshot_type: 'readme',
					file_path: readmePath,
					file_size: buf.length,
					sha256: hash,
					head_sha: null,
					archived_at: archivedAt,
					capture_reason: captureReason
				});
				appendRepoEvent(repo.id, 'readme_changed', {
					snapshot_type: 'readme',
					snapshot_id: snapshotId,
					sha256: hash,
					file_path: readmePath
				}, archivedAt);
				appendRepoEvent(repo.id, 'snapshot_created', {
					snapshot_type: 'readme',
					snapshot_id: snapshotId,
					sha256: hash,
					file_size: buf.length,
					file_path: readmePath
				}, archivedAt);
				indexRepoFtsById(repo.id, readme);
				result.readme = 'saved';
			}
		}
	} catch (err) {
		if (err instanceof GitHubRateLimitError) throw err;
		result.error = err instanceof Error ? err.message : String(err);
	}

	// Source tarball snapshot
	try {
		const headSha = await fetchBranchHeadSha(repo.owner, repo.name, branch);
		const latestHeadSha = getLatestSourceHeadSha(repo.id);

		if (latestHeadSha === headSha) {
			result.source = 'skipped';
			result.zip = config.createZipSnapshot
				? await ensureZipForLatestSource(repo, captureReason)
				: 'skipped';
			return result;
		}

		const tarball = await downloadSourceTarball(repo.owner, repo.name, branch, {
			maxBytes: config.maxBytes,
			timeoutMs: config.timeoutMs
		});

		const tarPath = join(dir, `${ts}-${branch}.tar.gz`);
		writeFileSync(tarPath, tarball);
		const hash = sha256(tarball);

		const snapshotId = insertArchiveSnapshot({
			repo_id: repo.id,
			snapshot_type: 'source',
			file_path: tarPath,
			file_size: tarball.length,
			sha256: hash,
			head_sha: headSha,
			archived_at: archivedAt,
			capture_reason: captureReason
		});
		const sourceSnapshot = {
			id: snapshotId,
			repo_id: repo.id,
			snapshot_type: 'source' as const,
			file_path: tarPath,
			file_size: tarball.length,
			sha256: hash,
			head_sha: headSha,
			archived_at: archivedAt,
			capture_reason: captureReason
		};
		appendRepoEvent(repo.id, 'snapshot_created', {
			snapshot_type: 'source',
			snapshot_id: snapshotId,
			sha256: hash,
			head_sha: headSha,
			file_size: tarball.length,
			file_path: tarPath
		}, archivedAt);
		result.source = 'saved';

		if (config.createZipSnapshot) {
			const zipSnapshotId = await createZipSnapshotForSource(
				repo,
				sourceSnapshot,
				tarball,
				archivedAt,
				captureReason
			);
			if (zipSnapshotId) {
				result.zip = 'saved';
				appendRepoEvent(repo.id, 'snapshot_created', {
					snapshot_type: 'zip',
					snapshot_id: zipSnapshotId,
					head_sha: headSha,
					source_snapshot_id: snapshotId
				}, archivedAt);
			}
		} else {
			result.zip = 'skipped';
		}
	} catch (err) {
		if (err instanceof GitHubRateLimitError) throw err;
		if (err instanceof GitHubNotFoundError) {
			await handleRepoNotFound(repo);
			result.source = 'missing';
		} else if (err instanceof DownloadTooLargeError) {
			result.source = 'too_large';
			result.error = err.message;
		} else if (err instanceof DownloadTimeoutError) {
			result.source = 'timeout';
			result.error = err.message;
		} else {
			result.error = err instanceof Error ? err.message : String(err);
		}
	}

	return result;
}

export function getArchiveConfigFromEnv(): ArchiveConfig {
	return {
		archiveDir: process.env.ARCHIVE_DIR ?? './data/archives',
		maxBytes: Number(process.env.ARCHIVE_MAX_BYTES ?? 52_428_800),
		timeoutMs: Number(process.env.ARCHIVE_TIMEOUT_MS ?? 120_000),
		createZipSnapshot:
			process.env.ARCHIVE_CREATE_ZIP === '1' ||
			process.env.ARCHIVE_CREATE_ZIP === 'true'
	};
}
