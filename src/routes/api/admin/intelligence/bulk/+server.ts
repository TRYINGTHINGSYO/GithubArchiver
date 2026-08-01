import { json } from '@sveltejs/kit';
import {
	applyOwnerPatternReclassify,
	previewOwnerPatternReclassify
} from '$lib/server/intelligence-audit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		action?: 'preview' | 'apply';
		owner?: string;
		descriptionTemplate?: string;
		toCategory?: string;
	};

	if (!body.owner || !body.descriptionTemplate || !body.toCategory) {
		return json(
			{ error: 'owner, descriptionTemplate, and toCategory are required' },
			{ status: 400 }
		);
	}

	if (body.action === 'apply') {
		const result = applyOwnerPatternReclassify({
			owner: body.owner,
			descriptionTemplate: body.descriptionTemplate,
			toCategory: body.toCategory,
			createdBy: 'admin'
		});
		return json({ ok: true, ...result });
	}

	const preview = previewOwnerPatternReclassify({
		owner: body.owner,
		descriptionTemplate: body.descriptionTemplate,
		toCategory: body.toCategory
	});
	return json({ ok: true, preview });
};
