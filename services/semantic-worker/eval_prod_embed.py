#!/usr/bin/env python3
"""
Production MiniLM embedding scorer for semantic-eval-prod.

Reads JSON from stdin:
  { "model": "...", "queries": [{ "id": "...", "text": "..." }],
    "documents": [{ "id": 1, "text": "..." }] }

Writes JSON to stdout:
  { "scores": { "<queryId>": [[docId, score], ...] } }

Exits 2 when sentence-transformers is not installed.
"""
from __future__ import annotations

import json
import sys


def main() -> int:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "sentence-transformers not installed",
                    "hint": "pip install -r services/semantic-worker/requirements-prod.txt",
                }
            ),
            file=sys.stderr,
        )
        return 2

    payload = json.load(sys.stdin)
    model_id = payload.get("model") or "sentence-transformers/all-MiniLM-L6-v2"
    queries = payload.get("queries") or []
    documents = payload.get("documents") or []

    model = SentenceTransformer(model_id)
    doc_ids = [int(d["id"]) for d in documents]
    doc_texts = [str(d["text"]) for d in documents]
    doc_emb = model.encode(doc_texts, normalize_embeddings=True)

    scores: dict[str, list[list[float | int]]] = {}
    for q in queries:
        qid = str(q["id"])
        q_emb = model.encode([str(q["text"])], normalize_embeddings=True)[0]
        ranked: list[tuple[int, float]] = []
        for i, doc_id in enumerate(doc_ids):
            # cosine similarity with normalized vectors == dot product
            sim = float((q_emb * doc_emb[i]).sum())
            ranked.append((doc_id, sim))
        ranked.sort(key=lambda x: (-x[1], x[0]))
        scores[qid] = [[doc_id, sim] for doc_id, sim in ranked]

    print(json.dumps({"ok": True, "model": model_id, "scores": scores}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
