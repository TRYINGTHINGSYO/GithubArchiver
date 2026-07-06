/** Normalize GitHub topics as an unordered set for comparison and storage. */
export function normalizeTopics(topics: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of topics) {
		const t = raw.trim().toLowerCase();
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	out.sort();
	return out;
}

export function topicsEqual(a: string[], b: string[]): boolean {
	const left = normalizeTopics(a);
	const right = normalizeTopics(b);
	if (left.length !== right.length) return false;
	return left.every((t, i) => t === right[i]);
}

export function topicSetDiff(
	prev: string[],
	next: string[]
): { added: string[]; removed: string[]; normalized: string[] } {
	const p = normalizeTopics(prev);
	const n = normalizeTopics(next);
	const prevSet = new Set(p);
	const nextSet = new Set(n);
	return {
		added: n.filter((t) => !prevSet.has(t)),
		removed: p.filter((t) => !nextSet.has(t)),
		normalized: n
	};
}
