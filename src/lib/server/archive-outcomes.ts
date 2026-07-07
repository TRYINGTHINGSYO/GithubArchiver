import type { ArchiveRepoResult } from '$lib/server/archiver';
import { appendRepoEvent } from '$lib/server/events';

export type ArchiveOutcomeBucket = 'saved' | 'skipped' | 'issues' | 'blocked';

export interface ArchiveRepoOutcome {
	repo: string;
	repoId: number;
	bucket: ArchiveOutcomeBucket;
	readme: ArchiveRepoResult['readme'];
	source: ArchiveRepoResult['source'];
	zip: ArchiveRepoResult['zip'];
	reason: string | null;
	permanent: boolean;
}

export function archiveFailureReason(result: ArchiveRepoResult): string | null {
	if (result.error) return result.error;
	if (result.source === 'too_large') return 'source tarball exceeds size limit';
	if (result.source === 'timeout') return 'source tarball download timed out';
	if (result.source === 'missing') return 'source snapshot missing';
	if (result.readme === 'missing' && result.source === 'missing') return 'no readme or source captured';
	return null;
}

export function isPermanentArchiveFailure(result: ArchiveRepoResult): boolean {
	if (result.source === 'too_large' || result.source === 'timeout') return true;
	const reason = archiveFailureReason(result);
	if (!reason) return false;
	if (/not found/i.test(reason)) return false;
	if (/rate limit/i.test(reason)) return false;
	if (/GitHub API 422/i.test(reason)) return true;
	if (/GitHub API 409/i.test(reason)) return true;
	return false;
}

export function classifyArchiveRepoOutcome(
	repoId: number,
	result: ArchiveRepoResult
): ArchiveRepoOutcome {
	const reason = archiveFailureReason(result);
	const permanent = isPermanentArchiveFailure(result);

	if (result.readme === 'saved' || result.source === 'saved') {
		return {
			repo: result.repo,
			repoId,
			bucket: 'saved',
			readme: result.readme,
			source: result.source,
			zip: result.zip,
			reason: null,
			permanent: false
		};
	}

	if (result.readme === 'skipped' && result.source === 'skipped') {
		return {
			repo: result.repo,
			repoId,
			bucket: 'skipped',
			readme: result.readme,
			source: result.source,
			zip: result.zip,
			reason: 'unchanged readme and source head',
			permanent: false
		};
	}

	if (
		result.source === 'too_large' ||
		result.source === 'timeout' ||
		result.source === 'missing' ||
		result.error
	) {
		return {
			repo: result.repo,
			repoId,
			bucket: permanent ? 'blocked' : 'issues',
			readme: result.readme,
			source: result.source,
			zip: result.zip,
			reason,
			permanent
		};
	}

	return {
		repo: result.repo,
		repoId,
		bucket: 'issues',
		readme: result.readme,
		source: result.source,
		zip: result.zip,
		reason: reason ?? 'unclassified archive outcome',
		permanent: false
	};
}

export function recordArchiveFailure(repoId: number, result: ArchiveRepoResult): void {
	const reason = archiveFailureReason(result) ?? 'archive failed';
	appendRepoEvent(repoId, 'archive_failed', {
		reason,
		permanent: isPermanentArchiveFailure(result),
		readme: result.readme,
		source: result.source,
		error: result.error ?? null
	});
}
