import './load-env.js';
import { readFileSync } from 'node:fs';
import { getDb } from '../src/lib/server/db/index.js';
import { parseTopics } from '../src/lib/server/db/repos.js';
import { clusterRepo } from '../src/lib/server/cluster-repo.js';

const before = JSON.parse(readFileSync('./data/intelligence-snapshot-before.json', 'utf8'));
const db = getDb();

for (const slug of ['healthcare-ai', 'cv-computer-vision']) {
	const prev = before.samples[slug] ?? [];
	console.log(`\n=== Former ${slug} (${prev.length}) ===`);
	for (const row of prev.slice(0, 12)) {
		const repo = db.prepare('SELECT * FROM repos WHERE full_name = ?').get(row.full_name) as
			| {
					owner: string;
					name: string;
					full_name: string;
					description: string | null;
					language: string | null;
					topics: string | null;
					category: string | null;
			  }
			| undefined;
		if (!repo) {
			console.log(row.full_name, 'MISSING');
			continue;
		}
		const matches = clusterRepo({
			owner: repo.owner,
			name: repo.name,
			full_name: repo.full_name,
			description: repo.description,
			language: repo.language,
			topics: parseTopics(repo.topics),
			category: repo.category
		});
		console.log(
			repo.full_name,
			`cat=${repo.category}`,
			`wasConf=${row.confidence ?? '?'}`,
			`now=${matches.map((m) => `${m.slug}:${m.confidence.toFixed(2)}`).join(',') || 'none'}`
		);
	}
}

// Check enriched awesome-named repos
console.log('\n=== Enriched awesome-* repos ===');
const awesome = db
	.prepare(
		`SELECT full_name, category, category_confidence, enrichment_level,
		        substr(coalesce(description,''),1,100) d
		 FROM repos
		 WHERE enrichment_level >= 1
		   AND (name LIKE 'awesome%' OR full_name LIKE '%awesome-selfhosted%')
		 LIMIT 20`
	)
	.all();
console.log(awesome);
