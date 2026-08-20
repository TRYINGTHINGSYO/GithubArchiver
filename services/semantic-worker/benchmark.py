#!/usr/bin/env python3
"""Benchmark TurboVec indexing/search for GithubArchiver semantic worker settings."""

from __future__ import annotations

import argparse
import json
import os
import statistics
import tempfile
import time
from pathlib import Path

import numpy as np

from embedder import HashingEmbeddingProvider
from index_store import SemanticIndexStore


def percentile(values, p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((p / 100.0) * (len(ordered) - 1)))))
    return float(ordered[idx])


def run_bench(n: int, dim: int, bits: int, queries: int, k: int) -> dict:
    rng = np.random.default_rng(42)
    embedder = HashingEmbeddingProvider(dimensions=dim)
    vectors = np.asarray(
        [embedder.embed(f"repo semantic document {i} voice assistant network tool") for i in range(n)],
        dtype=np.float32,
    )
    ids = np.arange(1, n + 1, dtype=np.uint64)

    with tempfile.TemporaryDirectory() as tmp:
        path = str(Path(tmp) / "bench.tvim")
        store = SemanticIndexStore(
            path,
            dimensions=dim,
            bit_width=bits,
            embedding_model=embedder.model_id,
            schema_version=1,
            semantic_document_version=1,
        )
        t0 = time.perf_counter()
        store.upsert(ids.tolist(), vectors)
        sync_at = store.sync()
        build_s = time.perf_counter() - t0
        index_bytes = Path(path).stat().st_size

        query_vecs = [
            np.asarray(embedder.embed(f"query {i} local voice assistant"), dtype=np.float32)
            for i in range(queries)
        ]
        latencies = []
        t_search = time.perf_counter()
        for qv in query_vecs:
            s0 = time.perf_counter()
            store.search(qv, k)
            latencies.append((time.perf_counter() - s0) * 1000)
        search_s = time.perf_counter() - t_search

        # filtered allowlist (10%)
        allow = ids[::10]
        filt_lat = []
        for qv in query_vecs[: max(1, queries // 2)]:
            s0 = time.perf_counter()
            store.search(qv, k, allowlist=allow.tolist())
            filt_lat.append((time.perf_counter() - s0) * 1000)

        add_lat = []
        for i in range(20):
            vid = n + 1 + i
            vec = np.asarray([embedder.embed(f"extra {i}")], dtype=np.float32)
            s0 = time.perf_counter()
            store.upsert([vid], vec)
            add_lat.append((time.perf_counter() - s0) * 1000)

        rem_lat = []
        for i in range(20):
            vid = n + 1 + i
            s0 = time.perf_counter()
            store.remove([vid])
            rem_lat.append((time.perf_counter() - s0) * 1000)

        return {
            "n": n,
            "dim": dim,
            "bits": bits,
            "build_seconds": build_s,
            "vectors_per_sec": n / build_s if build_s else 0,
            "index_bytes": index_bytes,
            "last_sync_at": sync_at,
            "query_p50_ms": percentile(latencies, 50),
            "query_p95_ms": percentile(latencies, 95),
            "query_p99_ms": percentile(latencies, 99),
            "queries_per_sec": queries / search_s if search_s else 0,
            "filtered_p50_ms": percentile(filt_lat, 50),
            "filtered_p95_ms": percentile(filt_lat, 95),
            "add_p50_ms": percentile(add_lat, 50),
            "remove_p50_ms": percentile(rem_lat, 50),
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sizes", default="10000,100000")
    parser.add_argument("--dim", type=int, default=int(os.environ.get("SEMANTIC_EMBEDDING_DIMS", "384")))
    parser.add_argument("--bits", default="2,3,4")
    parser.add_argument("--queries", type=int, default=50)
    parser.add_argument("--k", type=int, default=10)
    args = parser.parse_args()

    sizes = [int(x) for x in args.sizes.split(",") if x.strip()]
    bits_list = [int(x) for x in args.bits.split(",") if x.strip()]
    results = []
    for n in sizes:
        for bits in bits_list:
            print(f"benchmarking n={n} bits={bits}…", flush=True)
            results.append(run_bench(n, args.dim, bits, args.queries, args.k))

    out_dir = Path("data/semantic")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "benchmark-results.json"
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    # Allow running from repo root
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
