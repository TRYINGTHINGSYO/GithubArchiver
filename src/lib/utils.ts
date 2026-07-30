export function timeAgo(iso: string): string {
	const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Compact elapsed duration for live job age (e.g. `45s`, `12m`, `1h 15m`). */
export function formatDurationCompact(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	if (totalSec < 60) return `${totalSec}s`;
	const totalMin = Math.floor(totalSec / 60);
	if (totalMin < 60) return `${totalMin}m`;
	const hours = Math.floor(totalMin / 60);
	const minutes = totalMin % 60;
	if (hours < 48) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	const days = Math.floor(hours / 24);
	const remHours = hours % 24;
	return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateShort(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
}

export function shortSha(value: string, len = 12): string {
	return value.length > len ? `${value.slice(0, len)}…` : value;
}

export function formatStarCount(stars: number | null | undefined): string {
	if (stars == null) return '—';
	if (stars < 1000) return String(stars);
	if (stars < 10_000) return `${(stars / 1000).toFixed(1).replace(/\.0$/, '')}k`;
	if (stars < 1_000_000) return `${Math.round(stars / 1000)}k`;
	return `${(stars / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function formatStarDisplay(stars: number | null | undefined): string {
	return formatStarCount(stars);
}

export function starTier(stars: number | null | undefined): number {
	const count = stars ?? 0;
	if (count >= 1000) return 5;
	if (count >= 250) return 4;
	if (count >= 50) return 3;
	if (count >= 10) return 2;
	if (count > 0) return 1;
	return 0;
}
