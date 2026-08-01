import { filterConflictingClusterSets } from '$lib/server/cluster-compatibility';
import { getClusterDefinition } from '$lib/server/cluster-registry';
import { getDb } from '$lib/server/db/connection';
import { parseTopics } from '$lib/server/db/repos';
import { CURRENT_SCORING_VERSION, confidenceBand } from '$lib/server/scoring-version';

export const INTELLIGENCE_REVIEW_OUTCOMES = [
	'correct',
	'incorrect-category',
	'incorrect-cluster',
	'missing-secondary-cluster',
	'low-value-generated',
	'spam',
	'uncertain',
	'needs-custom-rule',
	'generic-evidence',
	'needs-review'
] as const;

export type IntelligenceReviewOutcome = (typeof INTELLIGENCE_REVIEW_OUTCOMES)[number];

export interface IntelligenceReviewInput {
	repositoryId: number;
	outcome: IntelligenceReviewOutcome;
	notes?: string | null;
	reviewedCategory?: string | null;
	reviewedClusterSlug?: string | null;
	previousCategory?: string | null;
	influenceTuning?: boolean;
	reviewedBy?: string | null;
}

export interface CategoryAuditRow {
	id: number;
	full_name: string;
	owner: string;
	category: string;
	category_confidence: number | null;
	interesting_score: number | null;
	description: string | null;
	language: string | null;
	scoring_version: string | null;
	band: string;
	warning: string | null;
	strongest_evidence: string | null;
	review_status: string | null;
}

export interface ClusterAuditRow {
	full_name: string;
	cluster_slug: string;
	cluster_name: string;
	confidence: number;
	category: string | null;
	description: string | null;
	evidence_json: string;
	explanation: string;
}

export interface GenericEvidenceTermRow {
	term: string;
	count: number;
}

export interface CategoryContradictionRow {
	full_name: string;
	category: string;
	category_confidence: number | null;
	description: string | null;
	reason: string;
}

export interface OwnerPatternRow {
	owner: string;
	matching_repos: number;
	description_template: string;
	category_distribution: Record<string, number>;
	sample_repos: string[];
	recommended_action: string;
	recommended_category: string | null;
}

export interface IntelligenceAuditReport {
	generatedAt: string;
	scoringVersion: string;
	summary: {
		repositoriesAudited: number;
		unknownCount: number;
		lowConfidenceCount: number;
		likelyFalsePositives: number;
		unresolvedConflicts: number;
		ownerPatternAlerts: number;
		reviewsCompleted: number;
	};
	topReposPerCategory: Record<string, CategoryAuditRow[]>;
	lowestConfidenceCategories: CategoryAuditRow[];
	topReposPerCluster: Record<string, ClusterAuditRow[]>;
	likelyClusterFalsePositives: ClusterAuditRow[];
	multiClusterConflicts: {
		full_name: string;
		clusters: { slug: string; name: string; confidence: number }[];
		incompatiblePairs: Array<[string, string]>;
		compatibleSecondary: boolean;
	}[];
	genericEvidenceTerms: GenericEvidenceTermRow[];
	descriptionContradictions: CategoryContradictionRow[];
	ownerPatterns: OwnerPatternRow[];
	recentReviews: {
		id: number;
		repository_id: number;
		full_name: string;
		outcome: string;
		notes: string | null;
		reviewed_at: string;
		reviewed_category: string | null;
	}[];
	categoryCounts: { category: string; count: number }[];
	clusterCounts: { slug: string; name: string; count: number }[];
	queue: CategoryAuditRow[];
}

const GENERIC_EVIDENCE_TERMS = [
	'ai',
	'ml',
	'machine learning',
	'deep learning',
	'neural network',
	'model',
	'agent',
	'llm',
	'gpt',
	'chatbot'
];

/** Compatible personal-website wording must not contradict portfolio-ish descriptions. */
const CATEGORY_DESC_HINTS: Record<string, RegExp> = {
	'ai-project': /\b(llm|ai agent|mcp|rag|langchain|openai|gpt)\b/i,
	'personal-website':
		/\b((my |personal |professional )?(portfolio|resume|cv) (website|site|page)|personal (site|website)|blog|about me|graphic design portfolio)\b/i,
	'company-profile': /\bcompany profile|portfolio lead\b/i,
	'awesome-list': /\b(awesome|curated list)\b/i,
	product: /\b(saas|platform|product)\b/i,
	application: /\b(web app|application|npm run dev)\b/i,
	library: /\b(library|package|sdk|crate|pip install)\b/i,
	bot: /\b(telegram|discord|slack).*\bbot\b|\bbot\b.*(telegram|discord|webhook|command)\b/i,
	game: /\b(game|godot|unity|roblox)\b/i,
	dataset: /\b(dataset|data mining|corpus)\b/i
};

export function saveIntelligenceReview(input: IntelligenceReviewInput): number {
	if (!INTELLIGENCE_REVIEW_OUTCOMES.includes(input.outcome)) {
		throw new Error(`Invalid review outcome: ${input.outcome}`);
	}
	const db = getDb();
	const now = new Date().toISOString();
	const result = db
		.prepare(
			`INSERT INTO intelligence_reviews
			 (repository_id, outcome, notes, reviewed_category, reviewed_cluster_slug, reviewed_at, reviewed_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			input.repositoryId,
			input.outcome,
			input.notes ?? null,
			input.reviewedCategory ?? null,
			input.reviewedClusterSlug ?? null,
			now,
			input.reviewedBy ?? 'admin'
		);

	if (input.reviewedCategory) {
		db.prepare(
			`INSERT INTO intelligence_human_overrides
			 (repository_id, category, primary_cluster_slug, notes, scoring_version, created_at, updated_at, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(repository_id) DO UPDATE SET
			   category = excluded.category,
			   primary_cluster_slug = COALESCE(excluded.primary_cluster_slug, intelligence_human_overrides.primary_cluster_slug),
			   notes = excluded.notes,
			   scoring_version = excluded.scoring_version,
			   updated_at = excluded.updated_at,
			   created_by = excluded.created_by`
		).run(
			input.repositoryId,
			input.reviewedCategory,
			input.reviewedClusterSlug ?? null,
			input.notes ?? null,
			CURRENT_SCORING_VERSION,
			now,
			now,
			input.reviewedBy ?? 'admin'
		);
		db.prepare(
			`UPDATE repos SET category = ?, classified_at = ?, scoring_version = ? WHERE id = ?`
		).run(input.reviewedCategory, now, CURRENT_SCORING_VERSION, input.repositoryId);
	}

	return Number(result.lastInsertRowid);
}

export function listIntelligenceReviews(limit = 50) {
	const db = getDb();
	return db
		.prepare(
			`SELECT ir.*, r.full_name
			 FROM intelligence_reviews ir
			 JOIN repos r ON r.id = ir.repository_id
			 ORDER BY ir.reviewed_at DESC
			 LIMIT ?`
		)
		.all(limit) as {
		id: number;
		repository_id: number;
		full_name: string;
		outcome: string;
		notes: string | null;
		reviewed_at: string;
		reviewed_category: string | null;
	}[];
}

export function getHumanOverride(repositoryId: number): {
	category: string | null;
	primary_cluster_slug: string | null;
} | null {
	const row = getDb()
		.prepare(
			`SELECT category, primary_cluster_slug FROM intelligence_human_overrides WHERE repository_id = ?`
		)
		.get(repositoryId) as
		| { category: string | null; primary_cluster_slug: string | null }
		| undefined;
	return row ?? null;
}

function enrichCategoryRow(row: {
	id: number;
	full_name: string;
	owner: string;
	category: string;
	category_confidence: number | null;
	interesting_score: number | null;
	description: string | null;
	language: string | null;
	scoring_version?: string | null;
	classification_warnings_json?: string | null;
	classification_evidence_json?: string | null;
}): CategoryAuditRow {
	const confidence = row.category_confidence ?? 0;
	let strongest: string | null = null;
	try {
		const ev = row.classification_evidence_json
			? (JSON.parse(row.classification_evidence_json) as Array<{ signal?: string; weight?: number }>)
			: [];
		strongest = ev.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0]?.signal ?? null;
	} catch {
		strongest = null;
	}
	let warning: string | null = null;
	try {
		const warnings = row.classification_warnings_json
			? (JSON.parse(row.classification_warnings_json) as string[])
			: [];
		warning = warnings[0] ?? null;
	} catch {
		warning = null;
	}
	const latestReview = getDb()
		.prepare(
			`SELECT outcome FROM intelligence_reviews WHERE repository_id = ? ORDER BY reviewed_at DESC LIMIT 1`
		)
		.get(row.id) as { outcome: string } | undefined;

	return {
		id: row.id,
		full_name: row.full_name,
		owner: row.owner,
		category: row.category,
		category_confidence: row.category_confidence,
		interesting_score: row.interesting_score,
		description: row.description,
		language: row.language,
		scoring_version: row.scoring_version ?? null,
		band: confidenceBand(confidence),
		warning,
		strongest_evidence: strongest,
		review_status: latestReview?.outcome ?? null
	};
}

export function buildIntelligenceAuditReport(limitPerBucket = 10): IntelligenceAuditReport {
	const db = getDb();
	const repositoriesAudited = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos WHERE classified_at IS NOT NULL AND deleted_at IS NULL`
			)
			.get() as { c: number }
	).c;
	const unknownCount = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE deleted_at IS NULL AND (category IS NULL OR category = 'unknown')`
			)
			.get() as { c: number }
	).c;
	const lowConfidenceCount = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM repos
				 WHERE deleted_at IS NULL
				   AND category IS NOT NULL AND category != 'unknown'
				   AND category_confidence IS NOT NULL
				   AND category_confidence < 0.55`
			)
			.get() as { c: number }
	).c;

	const categories = db
		.prepare(
			`SELECT category, COUNT(*) as count
			 FROM repos
			 WHERE category IS NOT NULL AND deleted_at IS NULL
			 GROUP BY category
			 ORDER BY count DESC`
		)
		.all() as { category: string; count: number }[];

	const topReposPerCategory: Record<string, CategoryAuditRow[]> = {};
	for (const row of categories.slice(0, 20)) {
		const rows = db
			.prepare(
				`SELECT id, full_name, owner, category, category_confidence, interesting_score,
				        description, language, scoring_version, classification_warnings_json,
				        classification_evidence_json
				 FROM repos
				 WHERE category = ? AND deleted_at IS NULL
				 ORDER BY interesting_score IS NULL, interesting_score DESC, stars DESC
				 LIMIT ?`
			)
			.all(row.category, limitPerBucket) as Array<Parameters<typeof enrichCategoryRow>[0]>;
		topReposPerCategory[row.category] = rows.map(enrichCategoryRow);
	}

	const lowestConfidenceCategories = (
		db
			.prepare(
				`SELECT id, full_name, owner, category, category_confidence, interesting_score,
				        description, language, scoring_version, classification_warnings_json,
				        classification_evidence_json
				 FROM repos
				 WHERE category IS NOT NULL
				   AND category != 'unknown'
				   AND category_confidence IS NOT NULL
				   AND deleted_at IS NULL
				 ORDER BY category_confidence ASC, interesting_score DESC
				 LIMIT ?`
			)
			.all(limitPerBucket * 2) as Array<Parameters<typeof enrichCategoryRow>[0]>
	).map(enrichCategoryRow);

	const clusters = db
		.prepare(
			`SELECT c.slug, c.name, COUNT(*) as count
			 FROM repository_cluster_memberships m
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 JOIN repos r ON r.id = m.repository_id
			 WHERE r.deleted_at IS NULL
			 GROUP BY c.slug
			 ORDER BY count DESC`
		)
		.all() as { slug: string; name: string; count: number }[];

	const topReposPerCluster: Record<string, ClusterAuditRow[]> = {};
	for (const cluster of clusters.slice(0, 24)) {
		topReposPerCluster[cluster.slug] = (
			db
				.prepare(
					`SELECT r.full_name, c.slug as cluster_slug, c.name as cluster_name,
					        m.confidence, r.category, r.description, m.evidence_json
					 FROM repository_cluster_memberships m
					 JOIN repo_clusters c ON c.id = m.cluster_id
					 JOIN repos r ON r.id = m.repository_id
					 WHERE c.slug = ? AND r.deleted_at IS NULL
					 ORDER BY m.confidence DESC, r.interesting_score DESC
					 LIMIT ?`
				)
				.all(cluster.slug, limitPerBucket) as ClusterAuditRow[]
		).map((row) => ({
			...row,
			explanation: explainClusterConfidence(row.cluster_slug, row.confidence, row.evidence_json)
		}));
	}

	const likelyClusterFalsePositives = (
		db
			.prepare(
				`SELECT r.full_name, c.slug as cluster_slug, c.name as cluster_name,
				        m.confidence, r.category, r.description, m.evidence_json
				 FROM repository_cluster_memberships m
				 JOIN repo_clusters c ON c.id = m.cluster_id
				 JOIN repos r ON r.id = m.repository_id
				 WHERE r.deleted_at IS NULL
				 ORDER BY m.confidence ASC, r.interesting_score DESC
				 LIMIT ?`
			)
			.all(limitPerBucket * 4) as ClusterAuditRow[]
	)
		.filter((row) => {
			const min = getClusterDefinition(row.cluster_slug)?.minimumScore ?? 0.45;
			return row.confidence < min + 0.1;
		})
		.map((row) => ({
			...row,
			explanation: explainClusterConfidence(row.cluster_slug, row.confidence, row.evidence_json)
		}));

	const multiClusterConflicts = (
		db
			.prepare(
				`SELECT r.full_name, r.id
				 FROM repos r
				 JOIN repository_cluster_memberships m ON m.repository_id = r.id
				 WHERE r.deleted_at IS NULL
				 GROUP BY r.id
				 HAVING COUNT(*) >= 2
				 ORDER BY COUNT(*) DESC, MAX(m.confidence) DESC
				 LIMIT ?`
			)
			.all(limitPerBucket * 3) as { full_name: string; id: number }[]
	)
		.map((row) => {
			const memberships = db
				.prepare(
					`SELECT c.slug, c.name, m.confidence
					 FROM repository_cluster_memberships m
					 JOIN repo_clusters c ON c.id = m.cluster_id
					 WHERE m.repository_id = ?
					 ORDER BY m.confidence DESC`
				)
				.all(row.id) as { slug: string; name: string; confidence: number }[];
			const { conflicting, incompatiblePairs } = filterConflictingClusterSets(
				memberships.map((m) => m.slug)
			);
			return {
				full_name: row.full_name,
				clusters: memberships,
				incompatiblePairs,
				compatibleSecondary: !conflicting
			};
		})
		.filter((row) => !row.compatibleSecondary);

	const ownerPatterns = detectOwnerPatterns(limitPerBucket);
	const recentReviews = listIntelligenceReviews(25);

	return {
		generatedAt: new Date().toISOString(),
		scoringVersion: CURRENT_SCORING_VERSION,
		summary: {
			repositoriesAudited,
			unknownCount,
			lowConfidenceCount,
			likelyFalsePositives: likelyClusterFalsePositives.length,
			unresolvedConflicts: multiClusterConflicts.length,
			ownerPatternAlerts: ownerPatterns.length,
			reviewsCompleted: recentReviews.length
		},
		topReposPerCategory,
		lowestConfidenceCategories,
		topReposPerCluster,
		likelyClusterFalsePositives,
		multiClusterConflicts,
		genericEvidenceTerms: tallyGenericEvidenceTerms(limitPerBucket * 2),
		descriptionContradictions: findDescriptionContradictions(limitPerBucket * 2),
		ownerPatterns,
		recentReviews,
		categoryCounts: categories,
		clusterCounts: clusters,
		queue: lowestConfidenceCategories
	};
}

function explainClusterConfidence(
	slug: string,
	confidence: number,
	evidenceJson: string
): string {
	const min = getClusterDefinition(slug)?.minimumScore ?? 0.45;
	let weakOnly = false;
	try {
		const evidence = JSON.parse(evidenceJson) as {
			weakMatches?: string[];
			scoreBreakdown?: { weak?: number; topics?: number; name?: number; readme?: number };
		};
		const strong =
			(evidence.scoreBreakdown?.topics ?? 0) +
			(evidence.scoreBreakdown?.name ?? 0) +
			(evidence.scoreBreakdown?.readme ?? 0);
		weakOnly = strong === 0 && (evidence.scoreBreakdown?.weak ?? 0) > 0;
	} catch {
		/* ignore */
	}
	const parts = [
		`confidence ${(confidence * 100).toFixed(0)}%`,
		`threshold ${(min * 100).toFixed(0)}%`
	];
	if (weakOnly) parts.push('mostly generic/weak terms');
	if (confidence < min + 0.1) parts.push('near threshold — review recommended');
	return parts.join(' · ');
}

export function detectOwnerPatterns(limit = 12): OwnerPatternRow[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT owner, description, category, full_name
			 FROM repos
			 WHERE deleted_at IS NULL
			   AND description IS NOT NULL
			   AND TRIM(description) != ''
			 ORDER BY owner, id DESC
			 LIMIT 8000`
		)
		.all() as Array<{
		owner: string;
		description: string;
		category: string | null;
		full_name: string;
	}>;

	const byOwnerTemplate = new Map<
		string,
		{
			owner: string;
			template: string;
			repos: string[];
			categories: Record<string, number>;
		}
	>();

	for (const row of rows) {
		const template = normalizeDescriptionTemplate(row.description);
		if (!template || template.length < 12) continue;
		const key = `${row.owner}::${template}`;
		const bucket = byOwnerTemplate.get(key) ?? {
			owner: row.owner,
			template,
			repos: [],
			categories: {}
		};
		bucket.repos.push(row.full_name);
		const cat = row.category ?? 'unknown';
		bucket.categories[cat] = (bucket.categories[cat] ?? 0) + 1;
		byOwnerTemplate.set(key, bucket);
	}

	const patterns: OwnerPatternRow[] = [];
	for (const bucket of byOwnerTemplate.values()) {
		if (bucket.repos.length < 3) continue;
		const companyProfile = /company profile|portfolio lead/i.test(bucket.template);
		patterns.push({
			owner: bucket.owner,
			matching_repos: bucket.repos.length,
			description_template: bucket.template,
			category_distribution: bucket.categories,
			sample_repos: bucket.repos.slice(0, 5),
			recommended_action: companyProfile
				? 'reclassify-as-company-profile'
				: 'review-generated-pattern',
			recommended_category: companyProfile ? 'company-profile' : 'generated-content'
		});
	}

	return patterns
		.sort((a, b) => b.matching_repos - a.matching_repos)
		.slice(0, limit);
}

/** Collapse volatile tokens so repeated templates group together. */
export function normalizeDescriptionTemplate(description: string): string {
	return description
		.trim()
		.toLowerCase()
		.replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/g, '<email>')
		.replace(/\bhttps?:\/\/\S+/g, '<url>')
		.replace(/\b\d+\b/g, '<n>')
		// Collapse volatile trailing entity names after em/en dashes or hyphens.
		.replace(/\s*[—–-]\s*[a-z0-9 .,&'+-]{2,40}$/i, ' — <entity>')
		.replace(/\s+/g, ' ')
		.slice(0, 160);
}

function tallyGenericEvidenceTerms(limit: number): GenericEvidenceTermRow[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT r.description, r.topics, m.evidence_json
			 FROM repository_cluster_memberships m
			 JOIN repos r ON r.id = m.repository_id
			 WHERE r.deleted_at IS NULL
			 LIMIT 5000`
		)
		.all() as { description: string | null; topics: string | null; evidence_json: string }[];

	const counts = new Map<string, number>();
	for (const term of GENERIC_EVIDENCE_TERMS) counts.set(term, 0);

	for (const row of rows) {
		const blob = `${row.description ?? ''} ${parseTopics(row.topics).join(' ')} ${row.evidence_json}`.toLowerCase();
		for (const term of GENERIC_EVIDENCE_TERMS) {
			if (blob.includes(term)) {
				counts.set(term, (counts.get(term) ?? 0) + 1);
			}
		}
	}

	return [...counts.entries()]
		.map(([term, count]) => ({ term, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, limit);
}

function findDescriptionContradictions(limit: number): CategoryContradictionRow[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT full_name, category, category_confidence, description
			 FROM repos
			 WHERE description IS NOT NULL
			   AND category IS NOT NULL
			   AND category != 'unknown'
			   AND deleted_at IS NULL
			 ORDER BY category_confidence ASC
			 LIMIT 500`
		)
		.all() as {
		full_name: string;
		category: string;
		category_confidence: number | null;
		description: string | null;
	}[];

	const out: CategoryContradictionRow[] = [];
	for (const row of rows) {
		const desc = row.description ?? '';
		const ownHint = CATEGORY_DESC_HINTS[row.category];
		if (ownHint && ownHint.test(desc)) continue;

		// Personal portfolio website wording is compatible with personal-website.
		if (
			row.category === 'personal-website' &&
			CATEGORY_DESC_HINTS['personal-website'].test(desc)
		) {
			continue;
		}

		for (const [otherCategory, hint] of Object.entries(CATEGORY_DESC_HINTS)) {
			if (otherCategory === row.category) continue;
			if (
				row.category === 'personal-website' &&
				(otherCategory === 'portfolio' || otherCategory === 'portfolio-collection')
			) {
				continue;
			}
			if (hint.test(desc)) {
				out.push({
					full_name: row.full_name,
					category: row.category,
					category_confidence: row.category_confidence,
					description: row.description,
					reason: `Description looks more like ${otherCategory} than ${row.category}`
				});
				break;
			}
		}
		if (out.length >= limit) break;
	}
	return out;
}

export interface BulkReclassifyPreview {
	affectedCount: number;
	sampleRepos: Array<{ id: number; full_name: string; category: string | null }>;
	fromCategory: string | null;
	toCategory: string;
	owner: string | null;
	descriptionTemplate: string | null;
}

export function previewOwnerPatternReclassify(input: {
	owner: string;
	descriptionTemplate: string;
	toCategory: string;
	limit?: number;
}): BulkReclassifyPreview {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT id, full_name, category, description
			 FROM repos
			 WHERE deleted_at IS NULL AND owner = ?
			 LIMIT 2000`
		)
		.all(input.owner) as Array<{
		id: number;
		full_name: string;
		category: string | null;
		description: string | null;
	}>;

	const matched = rows.filter(
		(row) =>
			row.description &&
			normalizeDescriptionTemplate(row.description) === input.descriptionTemplate
	);
	return {
		affectedCount: matched.length,
		sampleRepos: matched.slice(0, input.limit ?? 8).map((row) => ({
			id: row.id,
			full_name: row.full_name,
			category: row.category
		})),
		fromCategory: null,
		toCategory: input.toCategory,
		owner: input.owner,
		descriptionTemplate: input.descriptionTemplate
	};
}

/** Apply a confirmed bulk reclassify; skips repositories with human overrides. */
export function applyOwnerPatternReclassify(input: {
	owner: string;
	descriptionTemplate: string;
	toCategory: string;
	createdBy?: string;
}): { affected: number; bulkOperationId: number } {
	const preview = previewOwnerPatternReclassify(input);
	const db = getDb();
	const now = new Date().toISOString();
	let affected = 0;

	const op = db
		.prepare(
			`INSERT INTO intelligence_bulk_operations
			 (operation_type, filter_json, from_category, to_category, affected_count, sample_json, rollback_json, created_at, created_by, confirmed)
			 VALUES ('owner-pattern-reclassify', ?, NULL, ?, ?, ?, ?, ?, ?, 1)`
		)
		.run(
			JSON.stringify({
				owner: input.owner,
				descriptionTemplate: input.descriptionTemplate
			}),
			input.toCategory,
			preview.affectedCount,
			JSON.stringify(preview.sampleRepos),
			JSON.stringify(preview.sampleRepos),
			now,
			input.createdBy ?? 'admin'
		);

	const bulkOperationId = Number(op.lastInsertRowid);

	const candidates = db
		.prepare(
			`SELECT id, description FROM repos WHERE deleted_at IS NULL AND owner = ?`
		)
		.all(input.owner) as Array<{ id: number; description: string | null }>;

	for (const row of candidates) {
		if (!row.description) continue;
		if (normalizeDescriptionTemplate(row.description) !== input.descriptionTemplate) continue;
		if (getHumanOverride(row.id)) continue;
		db.prepare(
			`UPDATE repos SET category = ?, classified_at = ?, scoring_version = ? WHERE id = ?`
		).run(input.toCategory, now, CURRENT_SCORING_VERSION, row.id);
		affected += 1;
	}

	db.prepare(`UPDATE intelligence_bulk_operations SET affected_count = ? WHERE id = ?`).run(
		affected,
		bulkOperationId
	);

	return { affected, bulkOperationId };
}
