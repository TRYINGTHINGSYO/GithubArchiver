import { describe, expect, it } from 'vitest';
import {
	classifyArchiveRepoOutcome,
	isPermanentArchiveFailure,
	archiveFailureReason
} from '$lib/server/archive-outcomes';
import type { ArchiveRepoResult } from '$lib/server/archiver';

function result(overrides: Partial<ArchiveRepoResult> = {}): ArchiveRepoResult {
	return {
		repo: 'owner/repo',
		readme: 'missing',
		source: 'missing',
		zip: 'missing',
		...overrides
	};
}

describe('archive-outcomes', () => {
	it('classifies saved source as saved', () => {
		const outcome = classifyArchiveRepoOutcome(1, result({ source: 'saved', zip: 'saved' }));
		expect(outcome.bucket).toBe('saved');
	});

	it('classifies too_large as permanent blocked', () => {
		const archive = result({ source: 'too_large', error: 'Download size 90000000 exceeds limit 52428800' });
		expect(isPermanentArchiveFailure(archive)).toBe(true);
		const outcome = classifyArchiveRepoOutcome(2, archive);
		expect(outcome.bucket).toBe('blocked');
		expect(outcome.reason).toContain('exceeds limit');
	});

	it('classifies timeout as permanent blocked', () => {
		const archive = result({ source: 'timeout', error: 'Download timed out after 120000ms' });
		expect(classifyArchiveRepoOutcome(3, archive).bucket).toBe('blocked');
	});

	it('classifies generic transient errors as issues', () => {
		const archive = result({ error: 'GitHub API 502: Server Error' });
		const outcome = classifyArchiveRepoOutcome(4, archive);
		expect(outcome.bucket).toBe('issues');
		expect(outcome.permanent).toBe(false);
	});

	it('does not drop unclassified combinations silently', () => {
		const archive = result({ readme: 'missing', source: 'missing' });
		const outcome = classifyArchiveRepoOutcome(5, archive);
		expect(outcome.bucket).toBe('issues');
		expect(archiveFailureReason(archive)).toBeTruthy();
	});
});
