export interface IntegerBounds {
	min: number;
	max: number;
}

function parseInteger(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isSafeInteger(value) ? value : null;
	}
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	if (!/^-?\d+$/.test(normalized)) return null;
	const parsed = Number(normalized);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

export function boundedInteger(
	value: unknown,
	fallback: number,
	bounds: IntegerBounds
): number {
	const parsed = parseInteger(value);
	if (parsed === null) return fallback;
	return Math.min(bounds.max, Math.max(bounds.min, parsed));
}

export function positiveInteger(value: unknown): number | undefined {
	const parsed = parseInteger(value);
	return parsed !== null && parsed > 0 ? parsed : undefined;
}

export function boundedNumber(
	value: unknown,
	fallback: number,
	bounds: { min: number; max: number }
): number {
	if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback;
	if (typeof value !== 'number' && typeof value !== 'string') return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(bounds.max, Math.max(bounds.min, parsed));
}
