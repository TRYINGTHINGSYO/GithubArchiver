import './load-env.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../src/lib/server/db/index.js';
import {
	CURRENT_EMERGING_DETECTION_VERSION,
	listEmergingTermAliases,
	listEmergingTermExclusions,
	type EmergingCandidateEvidence,
	type EmergingCandidateHistory,
	type EmergingTopicRow
} from '../src/lib/server/emerging-topics.js';

const LIMIT = Number(process.env.AUDIT_LIMIT ?? 50);
const VERSION = Number(process.env.AUDIT_VERSION ?? CURRENT_EMERGING_DETECTION_VERSION);
const OUT_DIR = process.env.AUDIT_OUT_DIR ?? './data';
const INCLUDE_DISMISSED = process.env.AUDIT_INCLUDE_DISMISSED === '1';

type AuditEntry = {
	rank: number;
	key: string;
	label: string;
	candidateType: string;
	status: string;
	reviewReason: string | null;
	emergingScore: number;
	currentCount: number;
	previousCount: number;
	currentPrevalence: number | null;
	previousPrevalence: number | null;
	prevalenceLiftPercent: number | null;
	distinctOwners: number;
	averageInterestingScore: number | null;
	lowSignalPercent: number;
	singleOwnerSharePercent: number;
	schoolAssignmentSharePercent: number;
	duplicateNamePercent: number;
	sources: Record<string, number>;
	aliasHits: Record<string, number>;
	history: EmergingCandidateHistory | null;
	topCategories: string[];
	topLanguages: string[];
	topRepos: string[];
	periodStart: string;
	periodEnd: string;
};

function main() {
	const db = getDb();

	const latest = db
		.prepare(
			`SELECT MAX(period_start) p FROM emerging_topics WHERE detection_version = ?`
		)
		.get(VERSION) as { p: string | null };
	if (!latest.p) {
		console.log(`No emerging topics found for detection version ${VERSION}. Run npm run detect:emerging first.`);
		return;
	}

	const statusFilter = INCLUDE_DISMISSED ? '' : `AND status NOT IN ('dismissed', 'expired')`;
	const rows = db
		.prepare(
			`SELECT * FROM emerging_topics
			 WHERE detection_version = ? AND period_start = ? ${statusFilter}
			 ORDER BY emerging_score DESC
			 LIMIT ?`
		)
		.all(VERSION, latest.p, LIMIT) as EmergingTopicRow[];

	const entries: AuditEntry[] = rows.map((row, index) => {
		const evidence = JSON.parse(row.evidence_json) as EmergingCandidateEvidence;
		const history = row.history_json
			? (JSON.parse(row.history_json) as EmergingCandidateHistory)
			: null;
		const topOf = (counts: Record<string, number>, n: number) =>
			Object.entries(counts ?? {})
				.sort((a, b) => b[1] - a[1])
				.slice(0, n)
				.map(([name]) => name);
		return {
			rank: index + 1,
			key: row.key,
			label: row.label,
			candidateType: row.candidate_type,
			status: row.status,
			reviewReason: row.review_reason ?? null,
			emergingScore: row.emerging_score,
			currentCount: row.current_count,
			previousCount: row.previous_count,
			currentPrevalence: evidence.prevalence?.current ?? null,
			previousPrevalence: evidence.prevalence?.previous ?? null,
			prevalenceLiftPercent: evidence.prevalence?.liftPercent ?? null,
			distinctOwners: row.distinct_owner_count,
			averageInterestingScore: row.average_interesting_score,
			lowSignalPercent: Math.round((evidence.ratios?.lowSignal ?? 0) * 100),
			singleOwnerSharePercent: Math.round((evidence.ratios?.singleOwnerShare ?? 0) * 100),
			schoolAssignmentSharePercent: Math.round((evidence.ratios?.schoolAssignmentShare ?? 0) * 100),
			duplicateNamePercent: Math.round((evidence.ratios?.duplicateName ?? 0) * 100),
			sources: evidence.sources ?? {},
			aliasHits: evidence.aliasHits ?? {},
			history,
			topCategories: topOf(evidence.categories, 3),
			topLanguages: topOf(evidence.languages, 3),
			topRepos: (evidence.exampleRepos ?? []).slice(0, 5).map((repo) => repo.fullName),
			periodStart: row.period_start,
			periodEnd: row.period_end
		};
	});

	printReport(entries, latest.p);

	mkdirSync(OUT_DIR, { recursive: true });
	const stamp = new Date().toISOString().slice(0, 10);
	const jsonPath = join(OUT_DIR, `emerging-audit-${stamp}.json`);
	const csvPath = join(OUT_DIR, `emerging-audit-${stamp}.csv`);
	writeFileSync(
		jsonPath,
		JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				detectionVersion: VERSION,
				periodStart: latest.p,
				aliases: listEmergingTermAliases(),
				exclusions: listEmergingTermExclusions(),
				entries
			},
			null,
			2
		)
	);
	writeFileSync(csvPath, toCsv(entries));
	console.log(`\nExported ${entries.length} entries:`);
	console.log(`  ${jsonPath}`);
	console.log(`  ${csvPath}`);
}

function printReport(entries: AuditEntry[], periodStart: string) {
	console.log(`Emerging topic audit — period starting ${periodStart} (version ${VERSION})`);
	console.log(`${entries.length} candidates\n`);

	for (const entry of entries) {
		const sources = Object.entries(entry.sources)
			.map(([type, count]) => `${type} ${count}`)
			.join(', ');
		const aliases = Object.entries(entry.aliasHits)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([alias]) => alias)
			.join(', ');
		console.log(`${entry.rank}. ${entry.key} [${entry.candidateType}] (${entry.status}${entry.reviewReason ? `: ${entry.reviewReason}` : ''})`);
		console.log(`   Score: ${entry.emergingScore}`);
		console.log(
			`   Current: ${entry.currentCount} | Previous: ${entry.previousCount} | Owners: ${entry.distinctOwners}`
		);
		if (entry.currentPrevalence != null && entry.previousPrevalence != null) {
			console.log(
				`   Prevalence: ${(entry.currentPrevalence * 100).toFixed(2)}% | Previous: ${(entry.previousPrevalence * 100).toFixed(2)}% | Lift: ${entry.prevalenceLiftPercent == null ? 'n/a' : `${entry.prevalenceLiftPercent}%`}`
			);
		}
		console.log(
			`   Avg interesting: ${entry.averageInterestingScore ?? '—'} | Low signal: ${entry.lowSignalPercent}% | Single-owner: ${entry.singleOwnerSharePercent}% | School: ${entry.schoolAssignmentSharePercent}%`
		);
		if (sources) console.log(`   Sources: ${sources}`);
		if (aliases) console.log(`   Top aliases: ${aliases}`);
		if (entry.history) {
			console.log(
				`   History: 4wk avg ${entry.history.fourWeekAverage} | all-time ${entry.history.allTimeCount} | first seen ${entry.history.firstSeenAt.slice(0, 10)} | growth streak ${entry.history.consecutiveGrowthPeriods}`
			);
		}
		if (entry.topCategories.length) console.log(`   Categories: ${entry.topCategories.join(', ')}`);
		if (entry.topLanguages.length) console.log(`   Languages: ${entry.topLanguages.join(', ')}`);
		if (entry.topRepos.length) console.log(`   Top repos: ${entry.topRepos.join(', ')}`);
		console.log('');
	}
}

function toCsv(entries: AuditEntry[]): string {
	const headers = [
		'rank',
		'key',
		'label',
		'candidate_type',
		'status',
		'review_reason',
		'emerging_score',
		'current_count',
		'previous_count',
		'current_prevalence',
		'previous_prevalence',
		'prevalence_lift_pct',
		'distinct_owners',
		'avg_interesting',
		'low_signal_pct',
		'single_owner_pct',
		'school_pct',
		'duplicate_name_pct',
		'four_week_average',
		'all_time_count',
		'first_seen_at',
		'growth_streak',
		'sources',
		'alias_hits',
		'top_categories',
		'top_languages',
		'top_repos'
	];
	const escape = (value: unknown) => {
		const str = value == null ? '' : String(value);
		return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
	};
	const lines = [headers.join(',')];
	for (const entry of entries) {
		lines.push(
			[
				entry.rank,
				entry.key,
				entry.label,
				entry.candidateType,
				entry.status,
				entry.reviewReason ?? '',
				entry.emergingScore,
				entry.currentCount,
				entry.previousCount,
				entry.currentPrevalence ?? '',
				entry.previousPrevalence ?? '',
				entry.prevalenceLiftPercent ?? '',
				entry.distinctOwners,
				entry.averageInterestingScore ?? '',
				entry.lowSignalPercent,
				entry.singleOwnerSharePercent,
				entry.schoolAssignmentSharePercent,
				entry.duplicateNamePercent,
				entry.history?.fourWeekAverage ?? '',
				entry.history?.allTimeCount ?? '',
				entry.history?.firstSeenAt ?? '',
				entry.history?.consecutiveGrowthPeriods ?? '',
				Object.entries(entry.sources)
					.map(([type, count]) => `${type}:${count}`)
					.join(' '),
				Object.entries(entry.aliasHits)
					.map(([alias, count]) => `${alias}:${count}`)
					.join(' '),
				entry.topCategories.join(' '),
				entry.topLanguages.join(' '),
				entry.topRepos.join(' ')
			]
				.map(escape)
				.join(',')
		);
	}
	return lines.join('\n') + '\n';
}

main();
