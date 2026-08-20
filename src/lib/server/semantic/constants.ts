/** Bump when semantic document construction changes (marks indexed rows stale). */
export const SEMANTIC_DOCUMENT_VERSION = 1;

/** Bump when TurboVec/index on-disk layout / protocol changes. */
export const SEMANTIC_INDEX_SCHEMA_VERSION = 1;

/** Default embedding dimensionality for the hashing provider and MiniLM-L6. */
export const SEMANTIC_DEFAULT_DIMENSIONS = 384;

/** Maximum characters kept from README / summary bodies in the semantic document. */
export const SEMANTIC_README_MAX_CHARS = 2_500;

/** Absolute max length of the assembled semantic document. */
export const SEMANTIC_DOCUMENT_MAX_CHARS = 4_000;

/** Soft cap for TurboVec allowlists before falling back to post-filter. */
export const SEMANTIC_ALLOWLIST_SOFT_MAX = 50_000;
