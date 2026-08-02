import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/server/auth/guards';
import {
	countUserInterestSeeds,
	getUserEmailPreference,
	updateUserEmailPreference
} from '$lib/server/db/email-preferences';
import { listCollectionRepositories } from '$lib/server/db/collections';
import { saveRepo } from '$lib/server/db/user-saved-repos';
import { personalizedEmailConfigured } from '$lib/server/personalized-email';
import type { RequestHandler } from './$types';

function minimumScoreFrom(value: unknown): number | null {
	const score = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

export const GET: RequestHandler = (event) => {
	const user = requireUser(event);
	return json({
		preference: getUserEmailPreference(user.id),
		email: user.email || null,
		interestCount: countUserInterestSeeds(user.id),
		deliveryConfigured: personalizedEmailConfigured()
	});
};

export const PATCH: RequestHandler = async (event) => {
	const user = requireUser(event);
	const body = (await event.request.json().catch(() => null)) as
		| { enabled?: unknown; minimumScore?: unknown }
		| null;
	if (typeof body?.enabled !== 'boolean') {
		return json({ error: 'enabled must be a boolean' }, { status: 400 });
	}
	const minimumScore = minimumScoreFrom(body.minimumScore);
	if (minimumScore === null) {
		return json({ error: 'minimumScore must be between 0 and 100' }, { status: 400 });
	}
	if (body.enabled && !user.email) {
		return json({ error: 'Your GitHub account did not provide an email address.' }, { status: 400 });
	}
	if (body.enabled && !personalizedEmailConfigured()) {
		return json({ error: 'Email delivery is not configured yet.' }, { status: 503 });
	}
	if (body.enabled) {
		for (const kind of ['favorites', 'watch_later'] as const) {
			for (const repo of listCollectionRepositories(event.locals.collectionOwner, kind)) {
				saveRepo(user.id, repo.id, null);
			}
		}
	}

	return json({
		ok: true,
		preference: updateUserEmailPreference(user.id, {
			enabled: body.enabled,
			minimumScore
		}),
		interestCount: countUserInterestSeeds(user.id)
	});
};
