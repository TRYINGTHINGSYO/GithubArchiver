import { createHash } from 'node:crypto';

export type SemanticEntityType = 'repository' | 'website';

export interface SemanticEntityRef {
	entityType: SemanticEntityType;
	/** Stable string key: repo id decimal, or registrable domain for websites. */
	entityKey: string;
	/** TurboVec IdMapIndex external id (uint64 as number when safe). */
	vectorId: number;
}

const WEBSITE_TYPE_BIT = 0x8000_0000_0000_0000n;

/**
 * Map a GithubArchiver entity to a stable TurboVec uint64 id.
 * Repositories use their SQLite `repos.id` directly.
 * Websites use the high bit set + a 63-bit FNV-style hash of the domain.
 */
export function semanticEntityRef(
	entityType: SemanticEntityType,
	entityKey: string | number
): SemanticEntityRef {
	const key = String(entityKey);
	if (entityType === 'repository') {
		const id = Number(key);
		if (!Number.isInteger(id) || id < 1 || id > Number.MAX_SAFE_INTEGER) {
			throw new Error(`invalid repository entity key: ${key}`);
		}
		return { entityType, entityKey: key, vectorId: id };
	}

	const digest = createHash('sha256').update(`website:${key}`).digest();
	let n = 0n;
	for (let i = 0; i < 8; i++) {
		n = (n << 8n) | BigInt(digest[i]!);
	}
	n &= WEBSITE_TYPE_BIT - 1n;
	n |= WEBSITE_TYPE_BIT;
	// JS number is safe for TurboVec wire protocol as long as we stay within 2^53;
	// for website ids we keep the low 53 bits of the hashed value with type tag in bit 52.
	const safe = Number((n & ((1n << 52n) - 1n)) | (1n << 52n));
	return { entityType, entityKey: key, vectorId: safe };
}

export function repositoryVectorId(repoId: number): number {
	return semanticEntityRef('repository', repoId).vectorId;
}
