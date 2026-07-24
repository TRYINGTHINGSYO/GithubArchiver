import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const label = process.argv[2] ?? 'snapshot';
const db = getDb();

const categoryCounts = db
	.prepare(
		`SELECT COALESCE(category, 'null') as category, COUNT(*) as count
		 FROM repos WHERE deleted_at IS NULL AND classified_at IS NOT NULL
		 GROUP BY category ORDER BY count DESC`
	)
	.all() as { category: string; count: number }[];

const clusterCounts = db
	.prepare(
		`SELECT c.slug, c.name, COUNT(*) as count
		 FROM repository_cluster_memberships m
		 JOIN repo_clusters c ON c.id = m.cluster_id
		 JOIN repos r ON r.id = m.repository_id
		 WHERE r.deleted_at IS NULL
		 GROUP BY c.slug ORDER BY count DESC`
	)
	.all() as { slug: string; name: string; count: number }[];

const analyzed = (
	db
		.prepare(
			`SELECT COUNT(*) as c FROM repos WHERE deleted_at IS NULL AND COALESCE(enrichment_level,0) >= 1`
		)
		.get() as { c: number }
).c;

const sample = (category: string, limit = 8) =>
	db
		.prepare(
			`SELECT full_name, category, category_confidence, description, language, topics
			 FROM repos
			 WHERE deleted_at IS NULL AND category = ?
			 ORDER BY interesting_score IS NULL, interesting_score DESC
			 LIMIT ?`
		)
		.all(category, limit);

const clusterSample = (slug: string, limit = 8) =>
	db
		.prepare(
			`SELECT r.full_name, r.category, r.description, m.confidence, r.topics
			 FROM repository_cluster_memberships m
			 JOIN repo_clusters c ON c.id = m.cluster_id
			 JOIN repos r ON r.id = m.repository_id
			 WHERE c.slug = ? AND r.deleted_at IS NULL
			 ORDER BY m.confidence DESC
			 LIMIT ?`
		)
		.all(slug, limit);

const report = {
	label,
	generatedAt: new Date().toISOString(),
	analyzed,
	categoryCounts,
	clusterCounts,
	samples: {
		'ai-project': sample('ai-project', 10),
		'personal-website': sample('personal-website', 10),
		'awesome-list': sample('awesome-list', 10),
		'cv-computer-vision': clusterSample('cv-computer-vision', 15),
		'ai-agents': clusterSample('ai-agents', 10),
		'healthcare-ai': clusterSample('healthcare-ai', 10)
	}
};

mkdirSync('./data', { recursive: true });
const path = join('./data', `intelligence-snapshot-${label}.json`);
writeFileSync(path, JSON.stringify(report, null, 2));
console.log(`Wrote ${path}`);
console.log(`Analyzed repos: ${analyzed}`);
console.log('Top categories:');
for (const row of categoryCounts.slice(0, 12)) console.log(`  ${row.category}: ${row.count}`);
console.log('Top clusters:');
for (const row of clusterCounts.slice(0, 12)) console.log(`  ${row.slug}: ${row.count}`);
