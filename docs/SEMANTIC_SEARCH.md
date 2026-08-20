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
| **Embedding provider** | Text → float32 vectors |
| **TurboVec worker** | Compressed vector index + id map (`IdMapIndex`) |
| **GithubArchiver ranking** | Combines semantic + lexical + archive quality |

When `SEMANTIC_SEARCH_ENABLED` is off or the worker is down:

- the app starts normally
- keyword/FTS search continues
- pages do not crash
- enrichment/daemon jobs do not fail

## Enable (production)

```bash
pip install -r services/semantic-worker/requirements.txt
pip install -r services/semantic-worker/requirements-prod.txt   # MiniLM
export SEMANTIC_SEARCH_ENABLED=1
export SEMANTIC_EMBEDDING_PROVIDER=sentence-transformers
export SEMANTIC_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
export SEMANTIC_EMBEDDING_DIMS=384
export SEMANTIC_INDEX_PATH=./data/semantic/index.tvim
npm run semantic:worker
npm run semantic:index
```

### Embedding providers

| Provider | Model | Use |
|----------|-------|-----|
| `hashing` | `hashing-v1` | **CI / deterministic tests only.** Token/char n-gram bag — not true semantic retrieval. |
| `sentence-transformers` (alias `local`) | `all-MiniLM-L6-v2` | **Production local embedder** (384-d). Install via `requirements-prod.txt`. |

Do not treat hashing-v1 results as semantic quality metrics for the live archive.

## Semantic document

`buildRepositorySemanticDocument` assembles a deterministic text card (name,
description/summary, language, topics, classification, homepage, cleaned README).
Versioned by `SEMANTIC_DOCUMENT_VERSION`.

## Fingerprint

```
SHA256(document_version + entity_id + document + embedding_model)
```

Stored in `semantic_index_state` (migration 047). Vectors are **not** stored in SQLite.

## Ranking formula

SQLite FTS5 `bm25()` returns **negative** scores (more-negative = better). We convert
with `lexical_similarity = -bm25` before min-max normalization.

```
semantic_norm = minmax(semantic_score)
lexical_norm  = minmax(-bm25)          # FTS5-native negatives preserved
quality_norm  = minmax(interesting_score/100 or soft log10(stars))

final_score =
  (semantic_norm * SEMANTIC_SEARCH_WEIGHT
 + lexical_norm  * SEMANTIC_LEXICAL_WEIGHT
 + quality_norm  * SEMANTIC_QUALITY_WEIGHT)
  / weight_sum
```

Defaults: `0.55 / 0.35 / 0.10`.

## Hard filters + allowlists

Normal path:

```
SQLite hard filters → eligible IDs → TurboVec allowlist search
```

When eligible count exceeds `SEMANTIC_ALLOWLIST_SOFT_MAX`:

```
TurboVec global top-K (enlarged)
        ↓
SELECT id FROM repos WHERE id IN (candidates) AND <complete hard filters>
        ↓
rank matching candidates only
```

Never approximate eligibility with “first N repo ids”.

**Baseline visibility always applies** — even when the user supplied no language /
stars / category filters. Every semantic or hybrid candidate ID is passed through
`filterRepoIdsByQuery` → `buildRepoFilters`, which excludes `deleted_at` and
`pending_deletion_at` (unless explicitly opted in). TurboVec hits alone are never
sufficient; the deletion worker is not the search correctness barrier.

## Pagination

Semantic/hybrid search ranks a **bounded candidate window**, then pages inside
that window. `total` / `totalPages` describe the window (`pagination:
'candidate-window'`), not the full corpus. Keyword/FTS mode still uses true FTS
pagination.

## Incremental indexing (crash-safe)

```
mark indexing
  → embed / TurboVec upsert
  → durable TurboVec sync()
  → mark SQLite indexed
```

If sync fails, rows stay `failed` / retryable — never `indexed` without a durable
vector. Removals follow the same rule: remove → sync → mark `removed`, including
removals-only cycles.

Backfill selects repos that are **missing / stale / incompatible** via
`LEFT JOIN semantic_index_state` ordered by `repos.id ASC`, so already-indexed
newest repos cannot starve the historical archive.

Startup/index-cycle reconciliation repairs:

- SQLite `indexed` but vector missing → `stale`
- SQLite `removed` but vector still present → remove + durable sync

Sweeps use a **persisted `vector_id` keyset cursor** (`semantic_reconcile_cursor`)
with wraparound so every indexed/removed row is eventually examined. Bounded
work per cycle; no `OFFSET` over large tables; healthy rows do not pin the scan
on the oldest `updated_at` forever.

## Deletion

Deleted / pending-deletion / missing repos are removed from TurboVec, synced, then
marked `removed` in SQLite. Until that happens, search still hides them via
baseline SQL eligibility.

## Worker compatibility

`checkWorkerCompatibility` is the single definition used by search, indexing,
similar-repos, and admin stats. It requires matching:

- `modelId`
- `dimensions`
- `vectorBits`
- `schemaVersion`
- `semanticDocumentVersion`

HTTP-healthy is not enough. On mismatch: do not index, do not mix vectors, fall
back search to keyword/FTS, and report a clear reason. Model/document/dimension/
bit mismatches mark active rows `stale`. Index `schemaVersion` mismatches require
`npm run semantic:rebuild` after aligning config.

## Model / dimension mismatches

On-disk `.tvim.meta.json` stores schema version, document version, embedding model,
dimensions, and bit width. Startup refuses incompatible indexes — no silent rebuild.
Use `npm run semantic:rebuild`.

## Commands

```bash
npm run semantic:worker
npm run semantic:index          # --limit --batch-size --force --dry-run --repo-id
npm run semantic:rebuild
npm run semantic:eval           # CI hashing / token-overlap stand-in
npm run semantic:eval:prod      # optional MiniLM meaning eval (needs requirements-prod)
npm run semantic:benchmark      # 10k/100k × 2/3/4-bit
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Mode control missing | Feature flag off — expected |
| Hybrid falls back to keyword | Worker down or incompatible — check health + compatibility fields |
| Dimension / model / doc / schema mismatch | Align SEMANTIC_* env; rebuild after schema changes |
| Production setup missing MiniLM | Install `requirements-prod.txt` |
| Index grows but search empty | Check sync succeeded before rows marked indexed |
| Deleted repo still in semantic hits | Should be impossible after eligibility filter — file a bug |
