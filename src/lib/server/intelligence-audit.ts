import { getClusterDefinition } from '$lib/server/cluster-registry';
import { getDb } from '$lib/server/db/connection';
import { parseTopics } from '$lib/server/db/repos';

export const INTELLIGENCE_REVIEW_OUTCOMES = [
	'correct',
	'incorrect-category',
	'incorrect-cluster',
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
	reviewedBy?: string | null;
}

export interface CategoryAuditRow {
	full_name: string;
	category: string;
	category_confidence: number | null;
	interesting_score: number | null;
	description: string | null;
	language: string | null;
}

export interface ClusterAuditRow {
	full_name: string;
	cluster_slug: string;
	cluster_name: string;
	confidence: number;
	category: string | null;
	description: string | null;
	evidence_json: string;
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

export interface IntelligenceAuditReport {
	generatedAt: string;
	topReposPerCategory: Record<string, CategoryAuditRow[]>;
	lowestConfidenceCategories: CategoryAuditRow[];
	topReposPerCluster: Record<string, ClusterAuditRow[]>;
	likelyClusterFalsePositives: ClusterAuditRow[];
	multiClusterConflicts: {
		full_name: string;
		clusters: { slug: string; name: string; confidence: number }[];
	}[];
	genericEvidenceTerms: GenericEvidenceTermRow[];
	descriptionContradictions: CategoryContradictionRow[];
	recentReviews: {
		id: number;
		repository_id: number;
		full_name: string;
		outcome: string;
		notes: string | null;
		reviewed_at: string;
	}[];
	categoryCounts: { category: string; count: number }[];
	clusterCounts: { slug: string; name: string; count: number }[];
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

const CATEGORY_DESC_HINTS: Record<string, RegExp> = {
	'ai-project': /\b(llm|ai agent|mcp|rag|langchain|openai|gpt)\b/i,
	'personal-website': /\b(personal (site|website)|blog|portfolio|resume)\b/i,
	'awesome-list': /\b(awesome|curated list)\b/i,
	product: /\b(saas|platform|product|app)\b/i,
	library: /\b(library|package|sdk|crate)\b/i,
	game: /\b(game|godot|unity|roblox)\b/i
};

export function saveIntelligenceReview(input: IntelligenceReviewInput): number {
	if (!INTELLIGENCE_REVIEW_OUTCOMES.includes(input.outcome)) {
		throw new Error(`Invalid review outcome: ${input.outcome}`);
	}
	const db = getDb();
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
			new Date().toISOString(),
			input.reviewedBy ?? 'admin'
		);
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
	}[];
}

export function buildIntelligenceAuditReport(limitPerBucket = 10): IntelligenceAuditReport {
	const db = getDb();
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
		topReposPerCategory[row.category] = db
			.prepare(
				`SELECT full_name, category, category_confidence, interesting_score, description, language
				 FROM repos
				 WHERE category = ? AND deleted_at IS NULL
				 ORDER BY interesting_score IS NULL, interesting_score DESC, stars DESC
				 LIMIT ?`
			)
			.all(row.category, limitPerBucket) as CategoryAuditRow[];
	}

	const lowestConfidenceCategories = db
		.prepare(
			`SELECT full_name, category, category_confidence, interesting_score, description, language
			 FROM repos
			 WHERE category IS NOT NULL
			   AND category != 'unknown'
			   AND category_confidence IS NOT NULL
			   AND deleted_at IS NULL
			 ORDER BY category_confidence ASC, interesting_score DESC
			 LIMIT ?`
		)
		.all(limitPerBucket * 2) as CategoryAuditRow[];

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
		topReposPerCluster[cluster.slug] = db
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
			.all(cluster.slug, limitPerBucket) as ClusterAuditRow[];
	}

	const likelyClusterFalsePositives = db
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
		.all(limitPerBucket * 3) as ClusterAuditRow[];

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
			.all(limitPerBucket) as { full_name: string; id: number }[]
	).map((row) => {
		const memberships = db
			.prepare(
				`SELECT c.slug, c.name, m.confidence
				 FROM repository_cluster_memberships m
				 JOIN repo_clusters c ON c.id = m.cluster_id
				 WHERE m.repository_id = ?
				 ORDER BY m.confidence DESC`
			)
			.all(row.id) as { slug: string; name: string; confidence: number }[];
		return { full_name: row.full_name, clusters: memberships };
	});

	const genericEvidenceTerms = tallyGenericEvidenceTerms(limitPerBucket * 2);
	const descriptionContradictions = findDescriptionContradictions(limitPerBucket * 2);

	return {
		generatedAt: new Date().toISOString(),
		topReposPerCategory,
		lowestConfidenceCategories,
		topReposPerCluster,
		likelyClusterFalsePositives: likelyClusterFalsePositives.filter((row) => {
			const min = getClusterDefinition(row.cluster_slug)?.minimumScore ?? 0.45;
			return row.confidence < min + 0.1;
		}),
		multiClusterConflicts,
		genericEvidenceTerms,
		descriptionContradictions,
		recentReviews: listIntelligenceReviews(25),
		categoryCounts: categories,
		clusterCounts: clusters
	};
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

		for (const [otherCategory, hint] of Object.entries(CATEGORY_DESC_HINTS)) {
			if (otherCategory === row.category) continue;
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
