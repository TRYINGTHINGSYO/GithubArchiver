import type { ClassifyRepoInput } from '$lib/server/classify-repo';

export type SignalTier = 'low' | 'normal' | 'high';

export interface ScoreRepoInput extends ClassifyRepoInput {
	pushed_at?: string | null;
	deleted_at?: string | null;
}

export interface InterestingScoreResult {
	score: number;
	breakdown: {
		nameQuality: number;
		descriptionQuality: number;
		popularity: number;
		activity: number;
		metadata: number;
		penalties: number;
	};
}

const GENERIC_NAMES = new Set([
	'test',
	'tests',
	'testing',
	'hello',
	'hello-world',
	'world',
	'demo',
	'example',
	'sample',
	'tmp',
	'temp',
	'new',
	'project',
	'repo',
	'my-project',
	'myapp',
	'my-app',
	'app',
	'code',
	'sandbox',
	'playground',
	'stuff',
	'things',
	'abc',
	'abcd',
	'xyz',
	'asdf',
	'foo',
	'bar',
	'baz',
	'untitled',
	'new-repo',
	'first-repo',
	'practice',
	'learning',
	'tutorial',
	'wip',
	'work',
	'dev',
	'devops-test'
]);

const STRONG_GENERIC_PATTERNS = [
	/^\d+$/,
	/^[a-z]{1,3}$/i,
	/^test\d*$/i,
	/^hello-?world\d*$/i,
	/^demo\d*$/i,
	/^temp\d*$/i,
	/^asdf+$/i,
	/^[a-z]{2,4}\d{1,3}$/i
];

export function isGenericRepoName(name: string): boolean {
	const lower = name.toLowerCase();
	if (GENERIC_NAMES.has(lower)) return true;
	return STRONG_GENERIC_PATTERNS.some((re) => re.test(lower));
}

export function isStrongGarbageName(name: string): boolean {
	const lower = name.toLowerCase();
	if (GENERIC_NAMES.has(lower)) return true;
	return STRONG_GENERIC_PATTERNS.some((re) => re.test(lower));
}

function nameQualityScore(name: string): number {
	if (!isGenericRepoName(name)) {
		const len = name.length;
		if (len >= 8 && name.includes('-')) return 15;
		if (len >= 6) return 12;
		return 9;
	}
	return 2;
}

function descriptionQualityScore(description: string | null): number {
	if (!description?.trim()) return 0;
	const len = description.trim().length;
	if (len >= 120) return 15;
	if (len >= 50) return 11;
	if (len >= 15) return 7;
	return 3;
}

function popularityScore(stars: number, forks: number): number {
	const starPts = Math.min(20, Math.round(Math.log10(stars + 1) * 7));
	const forkPts = Math.min(10, Math.round(Math.log10(forks + 1) * 5));
	return starPts + forkPts;
}

function activityScore(pushedAt: string | null | undefined): number {
	if (!pushedAt) return 2;
	const days = Math.floor((Date.now() - new Date(pushedAt).getTime()) / 86_400_000);
	if (days <= 14) return 15;
	if (days <= 60) return 12;
	if (days <= 180) return 8;
	if (days <= 365) return 4;
	return 1;
}

function metadataScore(input: ScoreRepoInput): number {
	let score = 0;
	if (input.language) score += 3;
	if (input.topics.length > 0) score += Math.min(5, input.topics.length * 2);
	if (input.owner_type === 'Organization') score += 4;
	const readmeLen = (input.readmeExcerpt ?? '').trim().length;
	if (readmeLen > 2000) score += 8;
	else if (readmeLen > 500) score += 5;
	else if (readmeLen > 80) score += 2;
	return Math.min(15, score);
}

export function scoreRepoInteresting(input: ScoreRepoInput): InterestingScoreResult {
	const stars = input.stars ?? 0;
	const forks = input.forks ?? 0;

	const nameQuality = nameQualityScore(input.name);
	const descriptionQuality = descriptionQualityScore(input.description);
	const popularity = popularityScore(stars, forks);
	const activity = activityScore(input.pushed_at);
	const metadata = metadataScore(input);

	let penalties = 0;
	if (input.github_archived) penalties -= 8;
	if (input.deleted_at) penalties -= 10;
	if (isStrongGarbageName(input.name) && stars < 3 && forks < 2) penalties -= 12;

	const raw = nameQuality + descriptionQuality + popularity + activity + metadata + penalties;
	const score = Math.max(0, Math.min(100, raw));

	return {
		score,
		breakdown: {
			nameQuality,
			descriptionQuality,
			popularity,
			activity,
			metadata,
			penalties
		}
	};
}

export function detectSignalTier(input: ScoreRepoInput, interestingScore: number): SignalTier {
	const stars = input.stars ?? 0;
	const forks = input.forks ?? 0;
	const hasDescription = Boolean(input.description?.trim());
	const hasReadme = Boolean(input.readmeExcerpt?.trim());
	const isClassroom =
		input.topics.some((t) => t.toLowerCase() === 'github-classroom') ||
		(input.filePaths ?? []).some((p) => p.toLowerCase().includes('.github/classroom'));

	let weakSignals = 0;
	if (isStrongGarbageName(input.name)) weakSignals += 2;
	else if (isGenericRepoName(input.name)) weakSignals += 1;
	if (!hasDescription) weakSignals += 1;
	if (!hasReadme) weakSignals += 1;
	if (stars === 0) weakSignals += 1;
	if (forks === 0 && stars < 3) weakSignals += 1;
	if (input.topics.length === 0) weakSignals += 1;

	if (isStrongGarbageName(input.name) && stars < 5 && forks < 2) {
		return 'low';
	}

	if (isClassroom && !hasDescription && stars < 2) {
		return 'low';
	}

	if (weakSignals >= 5) {
		return 'low';
	}

	if (interestingScore >= 65 && weakSignals <= 2) {
		return 'high';
	}

	return 'normal';
}
