# Semantic worker

Local HTTP service that embeds GithubArchiver semantic documents and stores
compressed vectors in [TurboVec](https://github.com/RyanCodrai/turbovec) `IdMapIndex`.

## Setup

```bash
pip install -r services/semantic-worker/requirements.txt
# optional quality embedder:
# pip install sentence-transformers
```

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
