import { getDb } from './db/connection';
import { rebuildAllFts } from './db/fts';

export type CleanupPreset = 'safe' | 'conservative' | 'balanced' | 'aggressive';

export interface CleanupPresetDefinition {
	id: CleanupPreset;
	name: string;
	description: string;
	minAgeDays: number;
	protectEmergingDays: number;
	maxInterestingScore: number | null;
	requireEmptySize: boolean;
	requireGenericName: boolean;
	zeroStarsOnly: boolean;
	zeroForksOnly: boolean;
	requireNoDescription: boolean;
	requireNoHomepage: boolean;
	requireNoRelease: boolean;
	requireNoLanguage: boolean;
	requireNoTopics: boolean;
	requireNoReadme: boolean;
	requireNoPostCreateActivity: boolean;
	confirmedDeletedOnly: boolean;
	duplicateGithubIdOnly: boolean;
}

export interface CleanupOptions {
	preset?: CleanupPreset;
	minAgeDays?: number;
	protectEmergingDays?: number;
	maxInterestingScore?: number | null;
	sampleSize?: number;
	limit?: number;
	/** Days a repo must stay quarantined before permanent purge (default 7). */
	quarantineDays?: number;
	/** Purge quarantined rows immediately, ignoring the quarantine window. */
	forcePurge?: boolean;
	/** Also rebuild FTS after a permanent purge. */
	rebuildFts?: boolean;
}

export interface CleanupSampleRepo {
	id: number;
	full_name: string;
	created_at: string;
	stars: number | null;
	forks: number | null;
	language: string | null;
	description: string | null;
	homepage: string | null;
	enriched_at: string | null;
	interesting_score: number | null;
	deleted_at: string | null;
	pending_deletion_at: string | null;
	cleanup_reason: string | null;
}

export interface CleanupPreview {
	preset: CleanupPreset;
	options: Required<
		Pick<
			CleanupOptions,
			| 'minAgeDays'
			| 'protectEmergingDays'
			| 'maxInterestingScore'
			| 'sampleSize'
			| 'quarantineDays'
		>
	>;
	match_count: number;
	already_quarantined: number;
	purge_eligible: number;
	estimated_bytes_recoverable: number | null;
	samples: CleanupSampleRepo[];
	protections: string[];
}

export interface CleanupActionResult {
	preset: CleanupPreset;
	action: 'preview' | 'quarantine' | 'restore' | 'purge';
	matched: number;
	affected: number;
	samples: CleanupSampleRepo[];
	estimated_bytes_recoverable: number | null;
	message: string;
	fts_rebuilt?: boolean;
}

export const CLEANUP_PRESETS: Record<CleanupPreset, CleanupPresetDefinition> = {
	safe: {
		id: 'safe',
		name: 'Safe',
		description: 'Confirmed deleted repos and exact github_id duplicate extras only.',
		minAgeDays: 7,
		protectEmergingDays: 0,
		maxInterestingScore: null,
		requireEmptySize: false,
		requireGenericName: false,
		zeroStarsOnly: false,
		zeroForksOnly: false,
		requireNoDescription: false,
		requireNoHomepage: false,
		requireNoRelease: false,
		requireNoLanguage: false,
		requireNoTopics: false,
		requireNoReadme: false,
		requireNoPostCreateActivity: false,
		confirmedDeletedOnly: true,
		duplicateGithubIdOnly: true
	},
	conservative: {
		id: 'conservative',
		name: 'Conservative',
		description: 'Empty or obvious junk with zero engagement, 30+ days old.',
		minAgeDays: 30,
		protectEmergingDays: 30,
		maxInterestingScore: 30,
		requireEmptySize: false,
		requireGenericName: false,
		zeroStarsOnly: true,
		zeroForksOnly: true,
		requireNoDescription: true,
		requireNoHomepage: true,
		requireNoRelease: true,
		requireNoLanguage: true,
		requireNoTopics: true,
		requireNoReadme: true,
		requireNoPostCreateActivity: true,
		confirmedDeletedOnly: false,
		duplicateGithubIdOnly: false
	},
	balanced: {
		id: 'balanced',
		name: 'Balanced',
		description:
			'Zero engagement and weak metadata, 30+ days old. Protects favorites, collections, releases, websites, and young emerging projects.',
		minAgeDays: 30,
		protectEmergingDays: 30,
		maxInterestingScore: 35,
		requireEmptySize: false,
		requireGenericName: false,
		zeroStarsOnly: true,
		zeroForksOnly: true,
		requireNoDescription: true,
		requireNoHomepage: true,
		requireNoRelease: true,
		requireNoLanguage: true,
		requireNoTopics: true,
		requireNoReadme: true,
		requireNoPostCreateActivity: true,
		confirmedDeletedOnly: false,
		duplicateGithubIdOnly: false
	},
	aggressive: {
		id: 'aggressive',
		name: 'Aggressive',
		description: 'Low score / zero stars with weak signals, 14+ days old.',
		minAgeDays: 14,
		protectEmergingDays: 14,
		maxInterestingScore: 45,
		requireEmptySize: false,
		requireGenericName: false,
		zeroStarsOnly: true,
		zeroForksOnly: false,
		requireNoDescription: true,
		requireNoHomepage: true,
		requireNoRelease: true,
		requireNoLanguage: false,
		requireNoTopics: false,
		requireNoReadme: false,
		requireNoPostCreateActivity: false,
		confirmedDeletedOnly: false,
		duplicateGithubIdOnly: false
	}
};

const DEFAULT_QUARANTINE_DAYS = 7;
const AVG_BYTES_PER_REPO_FALLBACK = 8_192;

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function defaultQuarantineDays(): number {
	return envInt('CLEANUP_QUARANTINE_DAYS', DEFAULT_QUARANTINE_DAYS);
}

function isoDaysAgo(days: number): string {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function resolvePreset(preset: CleanupPreset = 'balanced'): CleanupPresetDefinition {
	return CLEANUP_PRESETS[preset] ?? CLEANUP_PRESETS.balanced;
}

function resolveOptions(
	opts: CleanupOptions = {}
): CleanupPresetDefinition & {
	sampleSize: number;
	limit: number | null;
	quarantineDays: number;
	forcePurge: boolean;
	rebuildFts: boolean;
	minAgeDays: number;
	protectEmergingDays: number;
	maxInterestingScore: number | null;
} {
	const preset = resolvePreset(opts.preset ?? 'balanced');
	return {
		...preset,
		minAgeDays: opts.minAgeDays ?? preset.minAgeDays,
		protectEmergingDays: opts.protectEmergingDays ?? preset.protectEmergingDays,
		maxInterestingScore:
			opts.maxInterestingScore === undefined
				? preset.maxInterestingScore
				: opts.maxInterestingScore,
		sampleSize: Math.max(1, Math.min(opts.sampleSize ?? 100, 200)),
		limit: opts.limit == null ? null : Math.max(1, Math.floor(opts.limit)),
		quarantineDays: opts.quarantineDays ?? defaultQuarantineDays(),
		forcePurge: Boolean(opts.forcePurge),
		rebuildFts: Boolean(opts.rebuildFts)
	};
}

/** Always-on protections — never delete curated or manually held repos. */
function protectionSql(alias = 'r'): string {
	return `
		COALESCE(${alias}.cleanup_protected, 0) = 0
		AND NOT EXISTS (SELECT 1 FROM repo_favorites f WHERE f.repo_id = ${alias}.id)
		AND NOT EXISTS (SELECT 1 FROM collection_repositories cr WHERE cr.repo_id = ${alias}.id)
	`;
}

function junkNameSql(alias = 'r'): string {
	return `(
		LOWER(${alias}.name) IN (
			'test','tests','testing','hello','hello-world','demo','example','sample',
			'tmp','temp','practice','homework','assignment','my-first-repo','first-repo',
			'new-repo','untitled','foo','bar','baz','asdf','playground','sandbox'
		)
		OR LOWER(${alias}.name) GLOB 'test[0-9]*'
		OR LOWER(${alias}.name) GLOB 'demo[0-9]*'
		OR LOWER(${alias}.name) GLOB 'temp[0-9]*'
		OR LOWER(${alias}.name) GLOB 'hello-world[0-9]*'
		OR LOWER(${alias}.name) LIKE 'homework%'
		OR LOWER(${alias}.name) LIKE 'assignment%'
		OR LOWER(${alias}.name) LIKE 'my-first-repo%'
		OR LOWER(${alias}.name) LIKE 'practice%'
	)`;
}

function weakDescriptionSql(alias = 'r'): string {
	return `(
		${alias}.description IS NULL
		OR TRIM(${alias}.description) = ''
		OR LENGTH(TRIM(${alias}.description)) < 15
	)`;
}

function noTopicsSql(alias = 'r'): string {
	return `(
		${alias}.topics IS NULL
		OR TRIM(${alias}.topics) = ''
		OR TRIM(${alias}.topics) = '[]'
	)`;
}

function noHomepageSql(alias = 'r'): string {
	return `(
		${alias}.homepage IS NULL
		OR TRIM(${alias}.homepage) = ''
	)`;
}

function noReadmeSql(alias = 'r'): string {
	return `NOT EXISTS (
		SELECT 1 FROM archive_snapshots a
		WHERE a.repo_id = ${alias}.id AND a.snapshot_type = 'readme'
	)`;
}

function noReleaseSql(alias = 'r'): string {
	return `NOT EXISTS (SELECT 1 FROM releases rl WHERE rl.repo_id = ${alias}.id)`;
}

function noPostCreateActivitySql(alias = 'r'): string {
	// Keep repos that show push activity meaningfully after birth.
	return `(
		${alias}.pushed_at IS NULL
		OR ${alias}.pushed_at <= datetime(${alias}.created_at, '+1 day')
	)`;
}

function buildMatchWhere(
	opts: ReturnType<typeof resolveOptions>,
	params: (string | number)[]
): string {
	const parts: string[] = [protectionSql('r')];

	if (opts.confirmedDeletedOnly || opts.duplicateGithubIdOnly) {
		const branches: string[] = [];
		if (opts.confirmedDeletedOnly) {
			branches.push(`(
				r.deleted_at IS NOT NULL
				AND r.deleted_at < ?
			)`);
			params.push(isoDaysAgo(opts.minAgeDays));
		}
		if (opts.duplicateGithubIdOnly) {
			// Keep the "best" row per github_id; match extras only.
			branches.push(`(
				r.github_id IS NOT NULL
				AND r.id NOT IN (
					SELECT keep_id FROM (
						SELECT
							github_id,
							id AS keep_id,
							ROW_NUMBER() OVER (
								PARTITION BY github_id
								ORDER BY
									CASE WHEN enriched_at IS NOT NULL THEN 0 ELSE 1 END,
									COALESCE(interesting_score, -1) DESC,
									COALESCE(stars, 0) DESC,
									id ASC
							) AS rn
						FROM repos
						WHERE github_id IS NOT NULL
					) ranked
					WHERE rn = 1
				)
			)`);
		}
		parts.push(`(${branches.join(' OR ')})`);
		return parts.join('\n AND ');
	}

	const emergingDays = Math.max(opts.minAgeDays, opts.protectEmergingDays);
	parts.push(`r.created_at < ?`);
	params.push(isoDaysAgo(emergingDays));

	if (opts.zeroStarsOnly) parts.push(`COALESCE(r.stars, 0) = 0`);
	if (opts.zeroForksOnly) parts.push(`COALESCE(r.forks, 0) = 0`);
	if (opts.requireNoDescription) parts.push(weakDescriptionSql('r'));
	if (opts.requireNoHomepage) parts.push(noHomepageSql('r'));
	if (opts.requireNoRelease) parts.push(noReleaseSql('r'));
	if (opts.requireNoLanguage) {
		parts.push(`(r.language IS NULL OR TRIM(r.language) = '')`);
	}
	if (opts.requireNoTopics) parts.push(noTopicsSql('r'));
	if (opts.requireNoReadme) parts.push(noReadmeSql('r'));
	if (opts.requireNoPostCreateActivity) parts.push(noPostCreateActivitySql('r'));
	if (opts.requireEmptySize) {
		parts.push(`(r.size IS NULL OR r.size = 0)`);
	}
	if (opts.requireGenericName) {
		parts.push(junkNameSql('r'));
	}
	if (opts.maxInterestingScore != null) {
		parts.push(`(r.interesting_score IS NULL OR r.interesting_score < ?)`);
		params.push(opts.maxInterestingScore);
	}

	// Conservative: empty repos OR obvious junk names (still gated by zero-engagement signals).
	if (opts.id === 'conservative') {
		parts.push(`((r.size IS NULL OR r.size = 0) OR ${junkNameSql('r')})`);
	}

	return parts.join('\n AND ');
}

function estimateBytesRecoverable(matchCount: number): number | null {
	if (matchCount <= 0) return 0;
	const db = getDb();
	try {
		const repoCount = (db.prepare('SELECT COUNT(*) AS c FROM repos').get() as { c: number }).c;
		if (repoCount <= 0) return null;
		const pageCount = Number(db.pragma('page_count', { simple: true }) ?? 0);
		const pageSize = Number(db.pragma('page_size', { simple: true }) ?? 0);
		const dbBytes = pageCount > 0 && pageSize > 0 ? pageCount * pageSize : 0;
		if (dbBytes <= 0) return matchCount * AVG_BYTES_PER_REPO_FALLBACK;
		// Rough share of DB attributable to matched repos (includes related row overhead).
		return Math.round((dbBytes / repoCount) * matchCount);
	} catch {
		return matchCount * AVG_BYTES_PER_REPO_FALLBACK;
	}
}

const SAMPLE_SELECT = `
	SELECT r.id, r.full_name, r.created_at, r.stars, r.forks, r.language,
	       r.description, r.homepage, r.enriched_at, r.interesting_score,
	       r.deleted_at, r.pending_deletion_at, r.cleanup_reason
	FROM repos r
`;

export function previewLowValueCleanup(opts: CleanupOptions = {}): CleanupPreview {
	const resolved = resolveOptions(opts);
	const db = getDb();
	const params: (string | number)[] = [];
	const where = buildMatchWhere(resolved, params);

	const matchCount = (
		db
			.prepare(`SELECT COUNT(*) AS c FROM repos r WHERE ${where} AND r.pending_deletion_at IS NULL`)
			.get(...params) as { c: number }
	).c;

	const alreadyQuarantined = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos r
				 WHERE ${protectionSql('r')} AND r.pending_deletion_at IS NOT NULL`
			)
			.get() as { c: number }
	).c;

	const purgeCutoff = isoDaysAgo(resolved.quarantineDays);
	const purgeEligible = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos r
				 WHERE ${protectionSql('r')}
				   AND r.pending_deletion_at IS NOT NULL
				   AND r.pending_deletion_at < ?`
			)
			.get(purgeCutoff) as { c: number }
	).c;

	const samples = db
		.prepare(
			`${SAMPLE_SELECT}
			 WHERE ${where} AND r.pending_deletion_at IS NULL
			 ORDER BY RANDOM()
			 LIMIT ?`
		)
		.all(...params, resolved.sampleSize) as CleanupSampleRepo[];

	return {
		preset: resolved.id,
		options: {
			minAgeDays: resolved.minAgeDays,
			protectEmergingDays: resolved.protectEmergingDays,
			maxInterestingScore: resolved.maxInterestingScore,
			sampleSize: resolved.sampleSize,
			quarantineDays: resolved.quarantineDays
		},
		match_count: matchCount,
		already_quarantined: alreadyQuarantined,
		purge_eligible: purgeEligible,
		estimated_bytes_recoverable: estimateBytesRecoverable(matchCount),
		samples,
		protections: [
			'Favorites (repo_favorites)',
			'Any collection membership (including Watch Later)',
			'Manual cleanup_protected flag',
			`Projects younger than ${Math.max(resolved.minAgeDays, resolved.protectEmergingDays)} days (emerging protection)`,
			'Releases, websites, README, language/topics (preset-dependent)',
			'Interesting score at/above cutoff (preset-dependent)'
		]
	};
}

export function quarantineLowValueRepos(opts: CleanupOptions = {}): CleanupActionResult {
	const resolved = resolveOptions(opts);
	const db = getDb();
	const params: (string | number)[] = [];
	const where = buildMatchWhere(resolved, params);
	const now = new Date().toISOString();
	const reason = `preset:${resolved.id}`;

	const selectSql = `
		SELECT r.id FROM repos r
		WHERE ${where} AND r.pending_deletion_at IS NULL
		${resolved.limit != null ? 'LIMIT ?' : ''}
	`;
	const selectParams =
		resolved.limit != null ? [...params, resolved.limit] : params;
	const ids = (
		db.prepare(selectSql).all(...selectParams) as Array<{ id: number }>
	).map((row) => row.id);

	if (ids.length > 0) {
		const update = db.prepare(
			`UPDATE repos
			 SET pending_deletion_at = ?, cleanup_reason = ?
			 WHERE id = ? AND pending_deletion_at IS NULL AND COALESCE(cleanup_protected, 0) = 0`
		);
		const tx = db.transaction((repoIds: number[]) => {
			for (const id of repoIds) update.run(now, reason, id);
		});
		tx(ids);
	}

	const samples = ids.length
		? (db
				.prepare(
					`${SAMPLE_SELECT}
					 WHERE r.id IN (${ids.slice(0, resolved.sampleSize).map(() => '?').join(',')})`
				)
				.all(...ids.slice(0, resolved.sampleSize)) as CleanupSampleRepo[])
		: [];

	return {
		preset: resolved.id,
		action: 'quarantine',
		matched: ids.length,
		affected: ids.length,
		samples,
		estimated_bytes_recoverable: estimateBytesRecoverable(ids.length),
		message:
			ids.length > 0
				? `Quarantined ${ids.length.toLocaleString()} repositories (hidden; purge after ${resolved.quarantineDays} days).`
				: 'No matching unprotected repositories to quarantine.'
	};
}

export function restoreQuarantinedRepos(opts: { limit?: number; ids?: number[] } = {}): CleanupActionResult {
	const db = getDb();
	let affected = 0;
	if (opts.ids?.length) {
		const update = db.prepare(
			`UPDATE repos SET pending_deletion_at = NULL, cleanup_reason = NULL WHERE id = ?`
		);
		const tx = db.transaction((ids: number[]) => {
			for (const id of ids) affected += update.run(id).changes;
		});
		tx(opts.ids);
	} else {
		const limit = opts.limit ?? 50_000;
		const result = db
			.prepare(
				`UPDATE repos
				 SET pending_deletion_at = NULL, cleanup_reason = NULL
				 WHERE id IN (
				   SELECT id FROM repos
				   WHERE pending_deletion_at IS NOT NULL
				   LIMIT ?
				 )`
			)
			.run(limit);
		affected = result.changes;
	}

	return {
		preset: 'balanced',
		action: 'restore',
		matched: affected,
		affected,
		samples: [],
		estimated_bytes_recoverable: 0,
		message:
			affected > 0
				? `Restored ${affected.toLocaleString()} quarantined repositories.`
				: 'No quarantined repositories to restore.'
	};
}

function deleteRelatedRows(repoId: number): void {
	const db = getDb();
	db.prepare('DELETE FROM repos_fts WHERE repo_id = ?').run(repoId);
	db.prepare('DELETE FROM repository_events WHERE repo_id = ?').run(repoId);
	db.prepare('DELETE FROM repo_aliases WHERE repo_id = ?').run(repoId);
	db.prepare(
		`DELETE FROM release_assets
		 WHERE release_id IN (SELECT id FROM releases WHERE repo_id = ?)`
	).run(repoId);
	db.prepare('DELETE FROM releases WHERE repo_id = ?').run(repoId);

	// Materialized discovery cards (no FK cascade).
	for (const table of [
		'discovery_projects_to_watch',
		'discovery_deleted_preserved',
		'discovery_unusual_finds'
	]) {
		try {
			db.prepare(`DELETE FROM ${table} WHERE repo_id = ?`).run(repoId);
		} catch {
			// Table may be absent on older schemas mid-repair.
		}
	}
}

export function purgeQuarantinedRepos(opts: CleanupOptions = {}): CleanupActionResult {
	const resolved = resolveOptions(opts);
	const db = getDb();
	const cutoff = resolved.forcePurge ? new Date().toISOString() : isoDaysAgo(resolved.quarantineDays);

	const selectSql = `
		SELECT r.id FROM repos r
		WHERE ${protectionSql('r')}
		  AND r.pending_deletion_at IS NOT NULL
		  AND r.pending_deletion_at <= ?
		${resolved.limit != null ? 'LIMIT ?' : ''}
	`;
	const selectParams =
		resolved.limit != null ? [cutoff, resolved.limit] : [cutoff];
	const ids = (
		db.prepare(selectSql).all(...selectParams) as Array<{ id: number }>
	).map((row) => row.id);

	if (ids.length > 0) {
		const deleteRepo = db.prepare('DELETE FROM repos WHERE id = ?');
		const tx = db.transaction((repoIds: number[]) => {
			for (const id of repoIds) {
				deleteRelatedRows(id);
				deleteRepo.run(id);
			}
		});
		tx(ids);
	}

	let ftsRebuilt = false;
	if (resolved.rebuildFts && ids.length > 0) {
		rebuildAllFts();
		ftsRebuilt = true;
	}

	return {
		preset: resolved.id,
		action: 'purge',
		matched: ids.length,
		affected: ids.length,
		samples: [],
		estimated_bytes_recoverable: estimateBytesRecoverable(ids.length),
		fts_rebuilt: ftsRebuilt,
		message:
			ids.length > 0
				? `Permanently deleted ${ids.length.toLocaleString()} quarantined repositories${ftsRebuilt ? ' and rebuilt FTS' : ''}. Run VACUUM separately to reclaim file space.`
				: resolved.forcePurge
					? 'No quarantined unprotected repositories to purge.'
					: `No quarantined repositories older than ${resolved.quarantineDays} days.`
	};
}

export function setCleanupProtected(repoId: number, protectedFlag: boolean): void {
	getDb()
		.prepare('UPDATE repos SET cleanup_protected = ? WHERE id = ?')
		.run(protectedFlag ? 1 : 0, repoId);
}

export function listCleanupPresets(): CleanupPresetDefinition[] {
	return Object.values(CLEANUP_PRESETS);
}
