import { json } from '@sveltejs/kit';
import { saveRepoFromInput } from '$lib/server/repo-save';
import type { RequestHandler } from './$types';

/** Look up a GitHub repo and save it into the local catalog (optional archive). */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		q?: string;
		owner?: string;
		name?: string;
		archive?: boolean;
	};

	const input =
		(body.q ?? '').trim() ||
		(body.owner && body.name ? `${body.owner}/${body.name}` : '');

	if (!input) {
		return json(
			{ ok: false, error: 'Provide q (owner/name or GitHub URL) or owner+name.' },
			{ status: 400 }
		);
	}

	const result = await saveRepoFromInput(input, {
		archive: Boolean(body.archive),
		source: 'manual'
	});

	return json(result, { status: result.ok ? 200 : result.error === 'not_found' ? 404 : 400 });
};
