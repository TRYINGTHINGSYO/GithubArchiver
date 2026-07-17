import type { GhArchiveEvent } from '../../src/lib/server/gharchive.js';
import {
	archiveUrlForKey,
	isRepositoryCreateEvent,
	streamHourEvents
} from '../../src/lib/server/gharchive.js';

export interface ParsedPayload {
	ref_type?: string;
	ref?: string | null;
	[key: string]: unknown;
}

export function parseEventPayload(payload: GhArchiveEvent['payload']): ParsedPayload | null {
	if (payload == null) return null;
	if (typeof payload === 'string') {
		try {
			return JSON.parse(payload) as ParsedPayload;
		} catch {
			return null;
		}
	}
	return payload as ParsedPayload;
}

export function looksLikeRepoCreation(event: GhArchiveEvent): boolean {
	return isRepositoryCreateEvent(event);
}

export interface HourInspection {
	hourKey: string;
	url: string;
	totalEvents: number;
	typeCounts: Record<string, number>;
	createEventPayloads: unknown[];
	refTypeCounts: Record<string, number>;
	repoNamePresence: { withRepoName: number; withoutRepoName: number };
	repoCreationSamples: GhArchiveEvent[];
	legacyMatcherCount: number;
	looksLikeRepoCreationCount: number;
}

export async function inspectHour(hourKey: string): Promise<HourInspection> {
	const url = archiveUrlForKey(hourKey);
	const typeCounts: Record<string, number> = {};
	const refTypeCounts: Record<string, number> = {};
	const createEventPayloads: unknown[] = [];
	const repoCreationSamples: GhArchiveEvent[] = [];
	let withRepoName = 0;
	let withoutRepoName = 0;
	let legacyMatcherCount = 0;
	let looksLikeRepoCreationCount = 0;
	let totalEvents = 0;

	for await (const event of streamHourEvents(url)) {
		totalEvents++;
		typeCounts[event.type] = (typeCounts[event.type] ?? 0) + 1;

		if (event.repo?.name) withRepoName++;
		else withoutRepoName++;

		if (event.type === 'CreateEvent') {
			const payload = parseEventPayload(event.payload);
			if (createEventPayloads.length < 10) {
				createEventPayloads.push(payload ?? event.payload);
			}
			const refType = payload?.ref_type ?? '(missing)';
			refTypeCounts[String(refType)] = (refTypeCounts[String(refType)] ?? 0) + 1;

			// legacy matcher: ref_type === 'repository' only
			if (payload?.ref_type === 'repository' && event.repo?.name) {
				legacyMatcherCount++;
			}

			if (looksLikeRepoCreation(event)) {
				looksLikeRepoCreationCount++;
				if (repoCreationSamples.length < 5) {
					repoCreationSamples.push(event);
				}
			}
		}
	}

	return {
		hourKey,
		url,
		totalEvents,
		typeCounts,
		createEventPayloads,
		refTypeCounts,
		repoNamePresence: { withRepoName, withoutRepoName },
		repoCreationSamples,
		legacyMatcherCount,
		looksLikeRepoCreationCount
	};
}

export function formatInspection(report: HourInspection): string {
	const lines: string[] = [];
	lines.push(`Hour:         ${report.hourKey}`);
	lines.push(`URL:          ${report.url}`);
	lines.push(`Total events: ${report.totalEvents}`);
	lines.push('');
	lines.push('Counts by event.type:');
	for (const [type, count] of Object.entries(report.typeCounts).sort((a, b) => b[1] - a[1])) {
		lines.push(`  ${type}: ${count}`);
	}
	lines.push('');
	lines.push('repo.name presence:');
	lines.push(`  with repo.name:    ${report.repoNamePresence.withRepoName}`);
	lines.push(`  without repo.name: ${report.repoNamePresence.withoutRepoName}`);
	lines.push('');
	lines.push('CreateEvent counts by payload.ref_type:');
	for (const [refType, count] of Object.entries(report.refTypeCounts).sort((a, b) => b[1] - a[1])) {
		lines.push(`  ${refType}: ${count}`);
	}
	lines.push('');
	lines.push('Matcher comparison (CreateEvent + repo.name):');
	lines.push(`  legacy (ref_type === "repository"): ${report.legacyMatcherCount}`);
	lines.push(`  current isRepositoryCreateEvent:   ${report.looksLikeRepoCreationCount}`);
	lines.push(
		'  (current also matches default-branch creates where ref === master_branch)'
	);
	lines.push('');
	lines.push('First 10 CreateEvent payloads:');
	for (const [i, payload] of report.createEventPayloads.entries()) {
		lines.push(`  [${i}] ${JSON.stringify(payload)}`);
	}
	lines.push('');
	lines.push('Sample events that look like repo creation:');
	for (const [i, event] of report.repoCreationSamples.entries()) {
		lines.push(`  [${i}] ${JSON.stringify(event, null, 2)}`);
	}
	return lines.join('\n');
}
