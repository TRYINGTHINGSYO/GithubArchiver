import { getDb } from './connection';

export interface UserEmailPreference {
	enabled: boolean;
	minimumScore: number;
	lastDigestAt: string | null;
}

export interface EmailDigestUser {
	id: string;
	name: string | null;
	email: string;
	minimumScore: number;
	lastDigestAt: string | null;
}

interface PreferenceRow {
	enabled: 0 | 1;
	minimum_score: number;
	last_digest_at: string | null;
}

const DEFAULT_PREFERENCE: UserEmailPreference = {
	enabled: false,
	minimumScore: 55,
	lastDigestAt: null
};

function toPreference(row: PreferenceRow | undefined): UserEmailPreference {
	return row
		? {
				enabled: row.enabled === 1,
				minimumScore: row.minimum_score,
				lastDigestAt: row.last_digest_at
			}
		: { ...DEFAULT_PREFERENCE };
}

export function getUserEmailPreference(userId: string): UserEmailPreference {
	const row = getDb()
		.prepare(
			`SELECT enabled, minimum_score, last_digest_at
			 FROM user_email_preferences WHERE user_id = ?`
		)
		.get(userId) as PreferenceRow | undefined;
	return toPreference(row);
}

export function updateUserEmailPreference(
	userId: string,
	input: { enabled: boolean; minimumScore: number }
): UserEmailPreference {
	const minimumScore = Math.min(100, Math.max(0, input.minimumScore));
	const now = new Date().toISOString();
	getDb()
		.prepare(
			`INSERT INTO user_email_preferences
			 (user_id, enabled, minimum_score, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET
			   enabled = excluded.enabled,
			   minimum_score = excluded.minimum_score,
			   updated_at = excluded.updated_at`
		)
		.run(userId, input.enabled ? 1 : 0, minimumScore, now, now);
	return getUserEmailPreference(userId);
}

export function listEnabledEmailDigestUsers(): EmailDigestUser[] {
	return getDb()
		.prepare(
			`SELECT u.id, u.name, u.email,
			        p.minimum_score AS minimumScore,
			        p.last_digest_at AS lastDigestAt
			 FROM user_email_preferences p
			 JOIN users u ON u.id = p.user_id
			 WHERE p.enabled = 1
			   AND u.email IS NOT NULL
			   AND trim(u.email) != ''
			 ORDER BY COALESCE(p.last_digest_at, '') ASC, u.id ASC`
		)
		.all() as EmailDigestUser[];
}

export function countUserInterestSeeds(userId: string): number {
	return (
		getDb()
			.prepare('SELECT COUNT(*) AS count FROM user_saved_repos WHERE user_id = ?')
			.get(userId) as { count: number }
	).count;
}

export function markUserDigestSent(
	userId: string,
	repoIds: number[],
	digestKey: string,
	providerMessageId: string | null,
	sentAt = new Date().toISOString()
): void {
	const db = getDb();
	db.transaction(() => {
		const insert = db.prepare(
			`INSERT OR IGNORE INTO personalized_email_deliveries
			 (user_id, repo_id, digest_key, provider_message_id, sent_at)
			 VALUES (?, ?, ?, ?, ?)`
		);
		for (const repoId of repoIds) {
			insert.run(userId, repoId, digestKey, providerMessageId, sentAt);
		}
		db.prepare(
			`UPDATE user_email_preferences
			 SET last_digest_at = ?, updated_at = ?
			 WHERE user_id = ?`
		).run(sentAt, sentAt, userId);
	})();
}
