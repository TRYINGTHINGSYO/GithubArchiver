#!/usr/bin/env python3
"""Compare TurboVec 2/3/4-bit recall against exact MiniLM cosine on a document dump."""
from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np


def recall_at_k(ranked_ids: list[int], relevant: set[int], k: int) -> float:
    if not relevant:
        return 0.0
    top = ranked_ids[:k]
    hits = sum(1 for i in top if i in relevant)
    return hits / len(relevant)


def mrr(ranked_ids: list[int], relevant: set[int], k: int) -> float:
    for i, vid in enumerate(ranked_ids[:k]):
        if vid in relevant:
            return 1.0 / (i + 1)
    return 0.0


def main() -> int:
    dump_path = Path(sys.argv[1])
    payload = json.loads(dump_path.read_text(encoding="utf-8"))

    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        print(json.dumps({"ok": False, "error": "sentence-transformers missing"}))
        return 2

    from index_store import SemanticIndexStore

    model_id = payload["model"]
    docs = payload["documents"]
    queries = payload["queries"]
    bits_list = payload.get("bits") or [2, 3, 4]
    out_dir = Path(payload.get("out_dir") or tempfile.mkdtemp())
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    model = SentenceTransformer(model_id)
    load_s = time.perf_counter() - t0

    texts = [d["text"] for d in docs]
    ids = [int(d["id"]) for d in docs]
    name_by_id = {int(d["id"]): d.get("full_name") for d in docs}
    id_by_name = {d.get("full_name"): int(d["id"]) for d in docs}

    t1 = time.perf_counter()
    doc_emb = model.encode(texts, normalize_embeddings=True, batch_size=64, show_progress_bar=False)
    doc_emb = np.asarray(doc_emb, dtype=np.float32)
    embed_s = time.perf_counter() - t1
    docs_per_s = len(texts) / embed_s if embed_s else 0.0

    # Exact rankings
    exact_rankings: dict[str, list[int]] = {}
    query_lat_ms: list[float] = []
    for q in queries:
        q0 = time.perf_counter()
        q_emb = model.encode([q["text"]], normalize_embeddings=True, show_progress_bar=False)[0]
        sims = doc_emb @ np.asarray(q_emb, dtype=np.float32)
        order = np.argsort(-sims)
        query_lat_ms.append((time.perf_counter() - q0) * 1000)
        exact_rankings[q["id"]] = [ids[int(i)] for i in order[:50]]

    bit_results = []
    for bits in bits_list:
        index_path = str(out_dir / f"bits-{bits}.tvim")
        store = SemanticIndexStore(
            index_path,
            dimensions=384,
            bit_width=int(bits),
            embedding_model=model_id,
            schema_version=1,
            semantic_document_version=1,
        )
        store.rebuild_empty()
        b0 = time.perf_counter()
        store.upsert(ids, doc_emb)
        store.sync()
        build_s = time.perf_counter() - b0
        stats = store.stats()

        recalls = []
        mrrs = []
        overlap10 = []
        search_ms = []
        for q in queries:
            relevant_names = set(q.get("relevant") or [])
            relevant_ids = {id_by_name[n] for n in relevant_names if n in id_by_name}
            q_emb = model.encode([q["text"]], normalize_embeddings=True, show_progress_bar=False)[0]
            s0 = time.perf_counter()
            scores, hit_ids = store.search(np.asarray(q_emb, dtype=np.float32), 50)
            search_ms.append((time.perf_counter() - s0) * 1000)
            hit_ids = [int(x) for x in hit_ids]
            recalls.append(recall_at_k(hit_ids, relevant_ids, 10))
            mrrs.append(mrr(hit_ids, relevant_ids, 10))
            exact = exact_rankings[q["id"]][:10]
            overlap10.append(len(set(hit_ids[:10]) & set(exact)) / 10.0)

        bit_results.append(
            {
                "bits": bits,
                "index_bytes": stats.get("indexBytes"),
                "build_s": build_s,
                "search_p50_ms": float(np.percentile(search_ms, 50)),
                "search_p95_ms": float(np.percentile(search_ms, 95)),
                "macro_recall_at_10": float(np.mean(recalls)),
                "macro_mrr": float(np.mean(mrrs)),
                "mean_overlap_at_10_vs_exact": float(np.mean(overlap10)),
            }
        )

    # Exact macro on relevance labels
    exact_recalls = []
    exact_mrrs = []
    for q in queries:
        relevant_ids = {
            id_by_name[n] for n in (q.get("relevant") or []) if n in id_by_name
        }
        ranked = exact_rankings[q["id"]]
        exact_recalls.append(recall_at_k(ranked, relevant_ids, 10))
        exact_mrrs.append(mrr(ranked, relevant_ids, 10))

    out = {
        "ok": True,
        "n_docs": len(docs),
        "model": model_id,
        "model_load_s": load_s,
        "embed_docs_s": embed_s,
        "docs_per_s": docs_per_s,
        "exact_query_p50_ms": float(np.percentile(query_lat_ms, 50)),
        "exact_query_p95_ms": float(np.percentile(query_lat_ms, 95)),
        "exact_macro_recall_at_10": float(np.mean(exact_recalls)),
        "exact_macro_mrr": float(np.mean(exact_mrrs)),
        "bits": bit_results,
        "sample_names": [name_by_id[i] for i in ids[:5]],
    }
    print(json.dumps(out, indent=2))
    (out_dir / "bit-comparison.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
