import { describe, expect, it } from 'vitest';
import { POST as reviewEmergingTopic } from '../src/routes/api/discovery/emerging/[key]/+server';
import {
	GET as listEmergingTopics,
	POST as detectEmergingTopics
} from '../src/routes/api/discovery/emerging/+server';
import { POST as startBulkExport } from '../src/routes/api/export/bulk/+server';
import { GET as readBulkExport } from '../src/routes/api/export/bulk/[jobId]/+server';
import { GET as downloadBulkExport } from '../src/routes/api/export/bulk/[jobId]/download/+server';
import { POST as saveRepository } from '../src/routes/api/repo/save/+server';
import { GET as readArchiveStory } from '../src/routes/api/repos/[id]/archive-story/+server';
import { POST as regenerateArchiveStory } from '../src/routes/api/repos/[id]/archive-story/regenerate/+server';

async function expectAdminRequired(response: Response): Promise<void> {
	expect(response.status).toBe(401);
	expect(await response.json()).toMatchObject({
		ok: false,
		error: 'Admin login required.'
	});
}

describe('admin write boundaries', () => {
	it('blocks anonymous emerging-topic review mutations', async () => {
		const response = await reviewEmergingTopic({
			locals: { isAdmin: false },
			params: { key: 'example-topic' },
			request: new Request('http://localhost/api/discovery/emerging/example-topic', {
				method: 'POST',
				body: JSON.stringify({ action: 'set-status', status: 'promoted' })
			})
		} as never);
		await expectAdminRequired(response);
	});

	it('blocks anonymous repository imports before external work starts', async () => {
		const response = await saveRepository({
			locals: { isAdmin: false },
			request: new Request('http://localhost/api/repo/save', {
				method: 'POST',
				body: JSON.stringify({ q: 'owner/repository', archive: true })
			})
		} as never);
		await expectAdminRequired(response);
	});

	it('blocks anonymous archive-story regeneration', async () => {
		const response = await regenerateArchiveStory({
			locals: { isAdmin: false },
			params: { id: '1' }
		} as never);
		await expectAdminRequired(response);
	});

	it('keeps intelligence GET endpoints free of regeneration side effects', async () => {
		const emerging = await listEmergingTopics({
			url: new URL('http://localhost/api/discovery/emerging?detect=1')
		} as never);
		expect(emerging.status).toBe(405);

		const story = await readArchiveStory({
			params: { id: '1' },
			url: new URL('http://localhost/api/repos/1/archive-story?regenerate=1')
		} as never);
		expect(story.status).toBe(405);
	});

	it('requires admin access for explicit detection and bulk exports', async () => {
		await expectAdminRequired(
			await detectEmergingTopics({
				locals: { isAdmin: false },
				request: new Request('http://localhost/api/discovery/emerging', {
					method: 'POST',
					body: '{}'
				})
			} as never)
		);
		await expectAdminRequired(
			await startBulkExport({
				locals: { isAdmin: false },
				url: new URL('http://localhost/api/export/bulk?scope=all&format=zip')
			} as never)
		);
		await expectAdminRequired(
			await readBulkExport({ locals: { isAdmin: false }, params: { jobId: '1' } } as never)
		);
		await expectAdminRequired(
			await downloadBulkExport({
				locals: { isAdmin: false },
				params: { jobId: '1' }
			} as never)
		);
	});
});
