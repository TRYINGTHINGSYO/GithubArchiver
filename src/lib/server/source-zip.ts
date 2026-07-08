import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
	getLatestArchiveSnapshot,
	insertArchiveSnapshot,
	type ArchiveSnapshotRow
} from '$lib/server/db/archive';
import { getDb } from '$lib/server/db/connection';
import type { RepoRow } from '$lib/server/db/types';
import { getArchiveDir, resolveSafeSnapshotPath } from '$lib/server/snapshots';
import { pipeArchiveToWriteStream } from '$lib/server/zip-stream';
import { isMetadataOnlyMode } from '$lib/server/runtime-mode';

async function createZipArchive() {
	const { ZipArchive } = await import('archiver');
	return new ZipArchive({ zlib: { level: 6 } });
}

function sha256(data: Buffer): string {
	return createHash('sha256').update(data).digest('hex');
}

function octalSize(raw: Buffer): number {
	const text = raw.toString('utf8').replace(/\0.*$/, '').trim();
	return text ? Number.parseInt(text, 8) || 0 : 0;
}

function stripRoot(path: string): string {
	const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
	const parts = clean.split('/').filter(Boolean);
	if (parts.length <= 1) return parts[0] ?? '';
	return parts.slice(1).join('/');
}

export function sourceZipFilePath(owner: string, name: string, snapshotId: number): string {
	return join(getArchiveDir(), 'zips', `${owner}__${name}__${snapshotId}.zip`);
}

export async function writeSourceZipFromTarball(tarball: Buffer, zipPath: string): Promise<number> {
	mkdirSync(dirname(zipPath), { recursive: true });
	const tar = gunzipSync(tarball);

	const output = createWriteStream(zipPath);
	const archive = await createZipArchive();
	const finishZip = pipeArchiveToWriteStream(archive, output);

	let offset = 0;
	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every((b) => b === 0)) break;

		const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
		const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
		const fullRawName = prefix ? `${prefix}/${rawName}` : rawName;
		const path = stripRoot(fullRawName);
		const size = octalSize(header.subarray(124, 136));
		const typeflag = String.fromCharCode(header[156] || 48);
		const isDirectory = typeflag === '5' || path.endsWith('/');

		if (path && !isDirectory) {
			const cleanPath = path.replace(/\/$/, '');
			const dataStart = offset + 512;
			archive.append(tar.subarray(dataStart, dataStart + size), { name: cleanPath });
		}

		offset += 512 + Math.ceil(size / 512) * 512;
	}

	await finishZip();

	return statSync(zipPath).size;
}

export async function writeSourceZipFromTarballPath(
	tarballPath: string,
	zipPath: string
): Promise<number> {
	return writeSourceZipFromTarball(readFileSync(tarballPath), zipPath);
}

export async function createZipSnapshotForSource(
	repo: RepoRow,
	sourceSnapshot: ArchiveSnapshotRow,
	tarball: Buffer,
	archivedAt: string,
	captureReason: string
): Promise<number | null> {
	if (isMetadataOnlyMode()) return null;

	const zipDir = join(getArchiveDir(), 'zips');
	mkdirSync(zipDir, { recursive: true });
	const tempZip = join(zipDir, `.tmp-${sourceSnapshot.id}-${Date.now()}.zip`);

	try {
		const zipSize = await writeSourceZipFromTarball(tarball, tempZip);
		const zipHash = sha256(readFileSync(tempZip));

		const zipSnapshotId = insertArchiveSnapshot({
			repo_id: repo.id,
			snapshot_type: 'zip',
			file_path: tempZip,
			file_size: zipSize,
			sha256: zipHash,
			head_sha: sourceSnapshot.head_sha,
			archived_at: archivedAt,
			capture_reason: captureReason
		});

		const finalPath = sourceZipFilePath(repo.owner, repo.name, zipSnapshotId);
		renameSync(tempZip, finalPath);

		getDb().prepare('UPDATE archive_snapshots SET file_path = ? WHERE id = ?').run(finalPath, zipSnapshotId);

		return zipSnapshotId;
	} catch {
		try {
			if (existsSync(tempZip)) {
				const { unlinkSync } = await import('node:fs');
				unlinkSync(tempZip);
			}
		} catch {
			// ignore cleanup errors
		}
		return null;
	}
}

export async function ensureZipForLatestSource(
	repo: RepoRow,
	captureReason = 'daemon'
): Promise<'saved' | 'skipped' | 'missing' | 'disabled'> {
	if (isMetadataOnlyMode()) return 'disabled';

	const source = getLatestArchiveSnapshot(repo.id, 'source');
	if (!source) return 'missing';

	const existingZip = getLatestArchiveSnapshot(repo.id, 'zip');
	if (existingZip?.head_sha === source.head_sha) {
		try {
			const safePath = resolveSafeSnapshotPath(existingZip.file_path);
			if (existsSync(safePath)) return 'skipped';
		} catch {
			// recreate below
		}
	}

	let safeTarPath: string;
	try {
		safeTarPath = resolveSafeSnapshotPath(source.file_path);
	} catch {
		return 'missing';
	}
	if (!existsSync(safeTarPath)) return 'missing';

	const tarball = readFileSync(safeTarPath);
	const zipId = await createZipSnapshotForSource(repo, source, tarball, source.archived_at, captureReason);
	return zipId ? 'saved' : 'missing';
}

export function getRepoZipDownloadUrl(owner: string, name: string, repoId: number): string | null {
	if (isMetadataOnlyMode()) return null;

	const zip = getLatestArchiveSnapshot(repoId, 'zip');
	if (zip) {
		try {
			if (existsSync(resolveSafeSnapshotPath(zip.file_path))) {
				return `/api/snapshots/${zip.id}`;
			}
		} catch {
			// fall through to export
		}
	}

	if (getLatestArchiveSnapshot(repoId, 'source')) {
		return `/api/repo/${owner}/${name}/export?type=source`;
	}

	return null;
}
