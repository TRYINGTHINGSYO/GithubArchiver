# Semantic search (TurboVec)

GithubArchiver remains software that understands and explains software. Semantic
search is an **optional deterministic retrieval signal**, not an LLM feature and
not a second source of truth.

## Architecture

```
User query
   │
   ▼
Existing query parser (filters + mode)
   │
   ├──────────────┬──────────────┐
   ▼              ▼              ▼
SQLite filters   FTS5 (BM25)   TurboVec (via worker)
language/stars   names/README  compressed vectors
category/dates   lexical rank  semantic similarity
   │              │              │
   └──────┬───────┴──────┬───────┘
          ▼              ▼
     Candidate IDs → hybrid rerank → results
```

| Layer | Owns |
|-------|------|
| **SQLite** | Repositories, websites, metadata, ratings, collections, hide/show, index *state* |
| **Embedding provider** | Text → float32 vectors (hashing or MiniLM) |
| **TurboVec worker** | Compressed vector index + id map (`IdMapIndex`) |
| **GithubArchiver ranking** | Combines semantic + lexical + archive quality |

When `SEMANTIC_SEARCH_ENABLED` is off or the worker is down:

- the app starts normally
- keyword/FTS search continues
- pages do not crash
- enrichment/daemon jobs do not fail

## Enable

1. Install worker deps: `pip install -r services/semantic-worker/requirements.txt`
2. Set env (see `.env.example`):
   - `SEMANTIC_SEARCH_ENABLED=1`
   - `SEMANTIC_INDEX_PATH=./data/semantic/index.tvim`
   - `SEMANTIC_EMBEDDING_PROVIDER=hashing` (CI/dev) or `sentence-transformers`
   - `SEMANTIC_EMBEDDING_MODEL=…`
   - `SEMANTIC_VECTOR_BITS=2` (3/4 also supported)
3. Start worker: `npm run semantic:worker`
4. Build index: `npm run semantic:index`
5. Open `/search` and choose **Hybrid** / **Semantic**

## Semantic document

`buildRepositorySemanticDocument` (see `src/lib/server/semantic/document.ts`)
assembles a deterministic text card:

- name / full name
- description / summary
- language, topics, classification
- homepage
- truncated, cleaned README signal (badges/install noise removed)

Versioned by `SEMANTIC_DOCUMENT_VERSION`. Changing construction marks rows stale.

## Fingerprint

```
SHA256(document_version + entity_id + document + embedding_model)
```

Stored in `semantic_index_state` (migration 047). Vectors themselves are **not**
stored in SQLite.

## Ranking formula

Within each candidate set:

```
semantic_norm = minmax(semantic_score)
lexical_norm  = minmax(1 / (1 + bm25))
quality_norm  = minmax(interesting_score/100 or soft log10(stars))

final_score =
  (semantic_norm * SEMANTIC_SEARCH_WEIGHT
 + lexical_norm  * SEMANTIC_LEXICAL_WEIGHT
 + quality_norm  * SEMANTIC_QUALITY_WEIGHT)
  / weight_sum
```

Defaults: `0.55 / 0.35 / 0.10`. Popularity cannot fully drown meaning.

## Hard filters + allowlists

SQLite evaluates hard filters first. Eligible ids are passed to TurboVec
`search(..., allowlist=…)`.

If the eligible set exceeds `SEMANTIC_ALLOWLIST_SOFT_MAX` (default 50k), the
worker searches without allowlist and results are post-filtered in SQL. This is
a documented fallback for pathological filter selectivity — not the common path.

## Incremental indexing

After enrichment (when enabled), repos are enqueued as `pending`. The
`semantic_index` cadence job / `npm run semantic:index` embeds changed
fingerprints only. States: `pending → indexing → indexed | failed`, plus
`stale` / `removed`.

DB rows are marked `indexed` **only after** a successful worker upsert.

## Deletion

Deleted / pending-deletion / missing repos are removed from TurboVec and marked
`removed` in SQLite during index cycles.

## Model / dimension mismatches

On-disk manifest (`.tvim.meta.json`) stores schema version, document version,
embedding model, dimensions, and bit width. Startup refuses incompatible indexes
— no silent rebuild. Use `npm run semantic:rebuild`.

## Similar repositories

`GET /api/repo/:owner/:repo/similar` re-embeds the repo’s semantic document and
queries TurboVec, excluding self and hidden rows.

## Benchmarks & eval

```bash
npm run semantic:benchmark   # 10k/100k × 2/3/4-bit (hashing vectors)
npm run semantic:eval        # Recall@10 / Precision@10 / MRR on fixtures
```

## Website-ready IDs

`semantic_index_state.entity_type` is `repository | website`. Repository vector
ids equal `repos.id`. Website ids use a reserved high-bit hash space via
`semanticEntityRef('website', domain)` so websites can join later without a
schema rewrite.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Mode control missing | Feature flag off — expected |
| Hybrid falls back to keyword | Worker down — check `npm run semantic:worker` |
| Dimension mismatch error | Rebuild after model change |
| Index grows but search empty | Ensure fingerprints marked indexed + sync |
