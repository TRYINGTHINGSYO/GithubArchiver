/**
 * Compatible secondary-cluster groups. Multi-membership is only a "conflict"
 * when clusters are not in the same compatibility clique and not explicitly paired.
 */

const COMPATIBLE_GROUPS: string[][] = [
	['mcp-servers', 'ai-agents', 'llm-wrappers', 'rag-applications', 'chat-applications'],
	['discord-bots', 'telegram-bots', 'trading-bots', 'chat-applications', 'ai-agents', 'llm-wrappers'],
	['portfolio-websites'],
	['cv-computer-vision', 'healthcare-ai', 'data-science', 'ai-agents'],
	['devops-templates', 'security-tools'],
	['e-commerce-apps', 'chat-applications'],
	['hackathon-projects'],
	['github-classroom-assignments'],
	['power-bi-dashboards'],
	['roblox-projects', 'minecraft-mods'],
	['url-shorteners']
];

/** Explicitly incompatible pairs (always conflicts). */
const INCOMPATIBLE_PAIRS: Array<[string, string]> = [
	['portfolio-websites', 'trading-bots'],
	['portfolio-websites', 'mcp-servers'],
	['portfolio-websites', 'rag-applications'],
	['github-classroom-assignments', 'mcp-servers'],
	['devops-templates', 'portfolio-websites'],
	['url-shorteners', 'portfolio-websites']
];

function pairKey(a: string, b: string): string {
	return a < b ? `${a}::${b}` : `${b}::${a}`;
}

const incompatible = new Set(INCOMPATIBLE_PAIRS.map(([a, b]) => pairKey(a, b)));

function shareCompatibleGroup(a: string, b: string): boolean {
	for (const group of COMPATIBLE_GROUPS) {
		if (group.includes(a) && group.includes(b)) return true;
	}
	return false;
}

/** True when two cluster memberships should be surfaced as a real conflict. */
export function clustersConflict(a: string, b: string): boolean {
	if (a === b) return false;
	if (incompatible.has(pairKey(a, b))) return true;
	if (shareCompatibleGroup(a, b)) return false;
	// Unknown pairing: treat as soft conflict only if unrelated families.
	return true;
}

export function filterConflictingClusterSets(
	slugs: string[]
): { conflicting: boolean; incompatiblePairs: Array<[string, string]> } {
	const unique = [...new Set(slugs)];
	const incompatiblePairs: Array<[string, string]> = [];
	for (let i = 0; i < unique.length; i++) {
		for (let j = i + 1; j < unique.length; j++) {
			const a = unique[i];
			const b = unique[j];
			if (clustersConflict(a, b)) incompatiblePairs.push([a, b]);
		}
	}
	return { conflicting: incompatiblePairs.length > 0, incompatiblePairs };
}
