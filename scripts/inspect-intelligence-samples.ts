import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';

const db = getDb();
const q = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
	db.prepare(sql).all(...params) as T[];
const one = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
	db.prepare(sql).get(...params) as T;

console.log('=== Cluster sizes of interest ===');
for (const slug of [
	'cv-computer-vision',
	'ai-agents',
	'healthcare-ai',
	'portfolio-websites',
	'llm-wrappers'
]) {
	const row = one<{ c: number }>(
		`SELECT COUNT(*) c FROM repository_cluster_memberships m
		 JOIN repo_clusters c ON c.id=m.cluster_id WHERE c.slug=?`,
		slug
	);
	console.log(slug, row.c);
}

console.log('\n=== CV members (all) ===');
console.log(
	q(
		`SELECT r.full_name, r.category, round(m.confidence,3) conf,
		        substr(coalesce(r.description,''),1,100) d
		 FROM repository_cluster_memberships m
		 JOIN repo_clusters c ON c.id=m.cluster_id
		 JOIN repos r ON r.id=m.repository_id
		 WHERE c.slug='cv-computer-vision'
		 ORDER BY m.confidence DESC`
	)
);

console.log('\n=== AI Agents sample ===');
console.log(
	q(
		`SELECT r.full_name, r.category, round(m.confidence,3) conf,
		        substr(coalesce(r.description,''),1,100) d
		 FROM repository_cluster_memberships m
		 JOIN repo_clusters c ON c.id=m.cluster_id
		 JOIN repos r ON r.id=m.repository_id
		 WHERE c.slug='ai-agents'
		 ORDER BY m.confidence DESC LIMIT 12`
	)
);

console.log('\n=== Healthcare AI sample ===');
console.log(
	q(
		`SELECT r.full_name, r.category, round(m.confidence,3) conf,
		        substr(coalesce(r.description,''),1,100) d
		 FROM repository_cluster_memberships m
		 JOIN repo_clusters c ON c.id=m.cluster_id
		 JOIN repos r ON r.id=m.repository_id
		 WHERE c.slug='healthcare-ai'
		 ORDER BY m.confidence DESC LIMIT 12`
	)
);

console.log('\n=== personal-website sample ===');
console.log(
	q(
		`SELECT full_name, round(category_confidence,3) conf,
		        substr(coalesce(description,''),1,100) d
		 FROM repos WHERE category='personal-website' AND deleted_at IS NULL
		 ORDER BY interesting_score IS NULL, interesting_score DESC LIMIT 12`
	)
);

console.log('\n=== ai-project sample ===');
console.log(
	q(
		`SELECT full_name, round(category_confidence,3) conf,
		        substr(coalesce(description,''),1,100) d
		 FROM repos WHERE category='ai-project' AND deleted_at IS NULL
		 ORDER BY interesting_score IS NULL, interesting_score DESC LIMIT 12`
	)
);

console.log('\n=== awesome-list ===');
console.log(one<{ c: number }>(`SELECT COUNT(*) c FROM repos WHERE category='awesome-list'`));
console.log(
	q(
		`SELECT full_name, substr(coalesce(description,''),1,100) d
		 FROM repos WHERE category='awesome-list' LIMIT 15`
	)
);

console.log('\n=== supabase / awesome matches ===');
console.log(
	q(
		`SELECT full_name, category, round(category_confidence,3) conf
		 FROM repos
		 WHERE full_name LIKE '%supabase%'
		    OR full_name LIKE '%awesome-selfhosted%'
		    OR name LIKE 'awesome%'
		 LIMIT 25`
	)
);

console.log('\n=== Former CV contaminants ===');
console.log(
	q(
		`SELECT r.full_name, r.category,
		  (SELECT group_concat(c.slug)
		     FROM repository_cluster_memberships m
		     JOIN repo_clusters c ON c.id=m.cluster_id
		    WHERE m.repository_id=r.id) AS clusters
		 FROM repos r
		 WHERE r.name LIKE '%crewai%'
		    OR r.name LIKE '%langgraph%'
		    OR r.name LIKE '%text-to-sql%'
		    OR r.description LIKE '%CrewAI%'
		    OR r.description LIKE '%LangGraph%'
		 LIMIT 25`
	)
);

console.log('\n=== Zero-baseline stories that also contain a percent ===');
const badStories = q<{ full_name: string; story_text: string }>(
	`SELECT full_name, story_text FROM repos
	 WHERE story_text LIKE '%after none were recorded%'
	   AND story_text LIKE '%increase%'
	 LIMIT 10`
);
console.log('count', badStories.length);
for (const row of badStories) {
	console.log(row.full_name, row.story_text.slice(0, 220));
}
