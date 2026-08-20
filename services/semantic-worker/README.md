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

## Run

```bash
export SEMANTIC_SEARCH_ENABLED=1
export SEMANTIC_EMBEDDING_PROVIDER=hashing   # or sentence-transformers
export SEMANTIC_INDEX_PATH=./data/semantic/index.tvim
npm run semantic:worker
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
