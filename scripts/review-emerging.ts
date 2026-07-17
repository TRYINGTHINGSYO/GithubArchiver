import './load-env.js';
import { getDb } from '../src/lib/server/db/index.js';
import {
	EMERGING_REVIEW_REASONS,
	excludeEmergingTopic,
	getEmergingTopicDetail,
	listEmergingTermAliases,
	listEmergingTermExclusions,
	mergeEmergingTopic,
	removeEmergingTermAlias,
	type EmergingReviewReason,
	type EmergingTopicStatus,
	updateEmergingTopicStatus
} from '../src/lib/server/emerging-topics.js';

const ACTIONS = [
	'exclude',
	'status',
	'merge',
	'show',
	'remove-alias',
	'list-aliases',
	'list-exclusions'
] as const;

const STATUSES = ['detected', 'reviewing', 'promoted', 'dismissed', 'expired'] as const;

function usage(message?: string): never {
	if (message) console.error(message);
	console.error(`Usage:
  npm run review:emerging -- exclude <key> <reason>
  npm run review:emerging -- status <key> <status> [reason]
  npm run review:emerging -- merge <from-key> <canonical-key>
  npm run review:emerging -- show <key>
  npm run review:emerging -- remove-alias <alias>
  npm run review:emerging -- list-aliases
  npm run review:emerging -- list-exclusions

Actions: ${ACTIONS.join(', ')}
Reasons: ${EMERGING_REVIEW_REASONS.join(', ')}
Statuses: ${STATUSES.join(', ')}`);
	process.exit(1);
}

function printTopic(key: string): void {
	const detail = getEmergingTopicDetail(key);
	if (!detail) {
		console.log(`${key}: not found`);
		return;
	}
	const { topic } = detail;
	console.log(
		`${topic.key}  label="${topic.label}"  type=${topic.candidate_type}  status=${topic.status}  reason=${topic.review_reason ?? '—'}  score=${topic.emerging_score}`
	);
}

function parseReason(value: string | undefined): EmergingReviewReason {
	if (!value) usage('Review reason is required');
	if (!(EMERGING_REVIEW_REASONS as readonly string[]).includes(value)) {
		throw new Error(`Unknown review reason: ${value}`);
	}
	return value as EmergingReviewReason;
}

function parseStatus(value: string | undefined): EmergingTopicStatus {
	if (!value) usage('Status is required');
	if (!(STATUSES as readonly string[]).includes(value)) {
		throw new Error(`Unknown status: ${value}`);
	}
	return value as EmergingTopicStatus;
}

function main() {
	getDb();
	const [action, ...args] = process.argv.slice(2);
	if (!action) usage();
	if (!(ACTIONS as readonly string[]).includes(action)) {
		usage(`Unknown action: ${action}`);
	}

	if (action === 'exclude') {
		const [key, reasonRaw] = args;
		if (!key) usage('Key is required for exclude');
		const reason = parseReason(reasonRaw);
		if (!excludeEmergingTopic(key, reason)) {
			throw new Error(`Could not exclude emerging topic: ${key}`);
		}
		console.log(`Excluded ${key} (${reason})`);
		printTopic(key);
		return;
	}

	if (action === 'status') {
		const [key, statusRaw, reasonRaw] = args;
		if (!key) usage('Key is required for status');
		const status = parseStatus(statusRaw);
		const reason = reasonRaw ? parseReason(reasonRaw) : undefined;
		if (!updateEmergingTopicStatus(key, status, reason)) {
			throw new Error(`Could not update status for emerging topic: ${key}`);
		}
		console.log(`Updated ${key} → ${status}${reason ? ` (${reason})` : ''}`);
		printTopic(key);
		return;
	}

	if (action === 'merge') {
		const [fromKey, canonicalKey] = args;
		if (!fromKey || !canonicalKey) usage('merge requires <from-key> <canonical-key>');
		if (!mergeEmergingTopic(fromKey, canonicalKey)) {
			throw new Error(`Could not merge ${fromKey} into ${canonicalKey}`);
		}
		console.log(`Merged ${fromKey} → ${canonicalKey}`);
		printTopic(fromKey);
		printTopic(canonicalKey);
		return;
	}

	if (action === 'show') {
		const [key] = args;
		if (!key) usage('Key is required for show');
		printTopic(key);
		return;
	}

	if (action === 'remove-alias') {
		const [alias] = args;
		if (!alias) usage('Alias is required for remove-alias');
		if (!removeEmergingTermAlias(alias)) {
			throw new Error(`Alias not found: ${alias}`);
		}
		console.log(`Removed alias ${alias}`);
		return;
	}

	if (action === 'list-aliases') {
		const rows = listEmergingTermAliases();
		if (rows.length === 0) {
			console.log('No aliases');
			return;
		}
		for (const row of rows) {
			console.log(`${row.alias} → ${row.canonical_key}`);
		}
		return;
	}

	if (action === 'list-exclusions') {
		const rows = listEmergingTermExclusions();
		if (rows.length === 0) {
			console.log('No exclusions');
			return;
		}
		for (const row of rows) {
			console.log(`${row.term}  (${row.reason})`);
		}
		return;
	}

	usage();
}

try {
	main();
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
}
