# Semantic worker

Local HTTP service that embeds GithubArchiver semantic documents and stores
compressed vectors in [TurboVec](https://github.com/RyanCodrai/turbovec) `IdMapIndex`.

## Setup

```bash
# Base (TurboVec + hashing CI embedder)
pip install -r services/semantic-worker/requirements.txt

# Production MiniLM embedder (required for real semantic retrieval)
pip install -r services/semantic-worker/requirements-prod.txt
```

`hashing-v1` is a deterministic token/char n-gram bag for CI only — not true
semantic understanding. Production must set
`SEMANTIC_EMBEDDING_PROVIDER=sentence-transformers`.

For Railway MiniLM production (from the production-snapshot gate), also set
**`SEMANTIC_VECTOR_BITS=4` explicitly**. The worker code fallback is `2` for CI;
omitting the env var in production would ship 2-bit by accident. Keep
`SEMANTIC_SEARCH_ENABLED=0` until you intentionally enable the feature.

## Run

```bash
# CI / local hashing (default bits fallback = 2)
export SEMANTIC_SEARCH_ENABLED=0
export SEMANTIC_EMBEDDING_PROVIDER=hashing
export SEMANTIC_INDEX_PATH=./data/semantic/index.tvim
npm run semantic:worker

# Production MiniLM example (flag still OFF until enable):
# export SEMANTIC_EMBEDDING_PROVIDER=sentence-transformers
# export SEMANTIC_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
# export SEMANTIC_EMBEDDING_DIMS=384
# export SEMANTIC_VECTOR_BITS=4
```

Protocol (localhost JSON):

- `GET /health`
- `GET /stats`
- `POST /search` `{ query, k, allowlist? }`
- `POST /similar` `{ query, vector_id?, k, allowlist? }`
- `POST /indexBatch` `{ items: [{ vectorId, text, ... }] }`
- `POST /remove` `{ vector_ids }`
- `POST /sync`
- `POST /rebuild`

The Node app never loads TurboVec directly.
