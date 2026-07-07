import { hourKey, parseHourKey } from './gharchive.js';

/** Hours since the UTC hour slot ended (GH Archive files appear after the hour completes). */
export function hoursSinceHourEnded(hourKey: string, nowMs: number = Date.now()): number {
	const hourEndMs = parseHourKey(hourKey).getTime() + 60 * 60 * 1000;
	return (nowMs - hourEndMs) / (60 * 60 * 1000);
}

export function publishGraceHours(): number {
	const raw = process.env.GHARCHIVE_PUBLISH_GRACE_HOURS;
	const n = raw === undefined || raw === '' ? 3 : Number(raw);
	return Number.isFinite(n) ? Math.max(0, n) : 3;
}

export function unavailableRetryCooldownHours(): number {
	const raw = process.env.GHARCHIVE_UNAVAILABLE_COOLDOWN_HOURS;
	const n = raw === undefined || raw === '' ? 6 : Number(raw);
	return Number.isFinite(n) ? Math.max(0, n) : 6;
}

export function isHourWithinPublishGrace(hourKey: string, nowMs: number = Date.now()): boolean {
	return hoursSinceHourEnded(hourKey, nowMs) < publishGraceHours();
}

export function isHourKeySameUtcDay(hourKey: string, nowMs: number = Date.now()): boolean {
	const hourDate = parseHourKey(hourKey);
	const now = new Date(nowMs);
	return (
		hourDate.getUTCFullYear() === now.getUTCFullYear() &&
		hourDate.getUTCMonth() === now.getUTCMonth() &&
		hourDate.getUTCDate() === now.getUTCDate()
	);
}

export interface HourUnavailableState {
	unavailable_at: string;
	http_status: number | null;
}

/**
 * Hours excluded from missingGhArchiveHours / ingest priority.
 * Distinguishes "not published yet" from genuinely missing historical hours.
 */
export function shouldExcludeHourFromMissingBacklog(
	hourKey: string,
	unavailable: HourUnavailableState | null,
	nowMs: number = Date.now()
): boolean {
	if (isHourWithinPublishGrace(hourKey, nowMs)) return true;

	if (unavailable?.http_status === 404) {
		if (isHourKeySameUtcDay(hourKey, nowMs)) return true;

		const attemptAgeMs = nowMs - Date.parse(unavailable.unavailable_at);
		if (attemptAgeMs < unavailableRetryCooldownHours() * 60 * 60 * 1000) return true;
	}

	return false;
}

export { hourKey, parseHourKey };
