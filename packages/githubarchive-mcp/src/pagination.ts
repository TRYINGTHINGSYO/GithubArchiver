export function boundedLimit(input: unknown, fallback = 25, max = 100): number {
  const parsed = Number(input ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

export function boundedOffset(input: unknown): number {
  const parsed = Number(input ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(Math.trunc(parsed), 0);
}
