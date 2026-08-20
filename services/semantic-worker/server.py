#!/usr/bin/env python3
"""GithubArchiver semantic index worker (TurboVec + embedding provider)."""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import numpy as np

from embedder import create_embedder
from index_store import SemanticIndexStore


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


def env_str(name: str, default: str) -> str:
    raw = os.environ.get(name)
    return raw.strip() if raw and raw.strip() else default


class WorkerState:
    def __init__(self) -> None:
        self.provider_name = env_str("SEMANTIC_EMBEDDING_PROVIDER", "hashing")
        if self.provider_name == "local":
            self.provider_name = "sentence-transformers"
        self.model_id = env_str(
            "SEMANTIC_EMBEDDING_MODEL",
            "sentence-transformers/all-MiniLM-L6-v2"
            if self.provider_name == "sentence-transformers"
            else "hashing-v1",
        )
        self.dimensions = env_int("SEMANTIC_EMBEDDING_DIMS", 384)
        self.bit_width = env_int("SEMANTIC_VECTOR_BITS", 2)
        if self.bit_width not in (2, 3, 4):
            raise RuntimeError("SEMANTIC_VECTOR_BITS must be 2, 3, or 4")
        self.schema_version = env_int("SEMANTIC_INDEX_SCHEMA_VERSION", 1)
        self.document_version = env_int("SEMANTIC_DOCUMENT_VERSION", 1)
        self.index_path = env_str("SEMANTIC_INDEX_PATH", "./data/semantic/index.tvim")
        self.embedder = create_embedder(
            self.provider_name, self.model_id, self.dimensions
        )
        self.model_id = self.embedder.model_id
        self.dimensions = self.embedder.dimensions
        self.store = SemanticIndexStore(
            self.index_path,
            dimensions=self.dimensions,
            bit_width=self.bit_width,
            embedding_model=self.model_id,
            schema_version=self.schema_version,
            semantic_document_version=self.document_version,
        )


STATE: Optional[WorkerState] = None


def get_state() -> WorkerState:
    assert STATE is not None
    return STATE


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[semantic-worker] " + (fmt % args) + "\n")

    def _read_json(self) -> Dict[str, Any]:
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _write_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            state = get_state()
            if path == "/health":
                stats = state.store.stats()
                self._write_json(
                    200,
                    {
                        "ok": True,
                        "modelId": state.model_id,
                        "dimensions": state.dimensions,
                        "vectorBits": state.bit_width,
                        "indexedCount": stats["indexedCount"],
                        "indexPath": state.index_path,
                        "schemaVersion": state.schema_version,
                        "semanticDocumentVersion": state.document_version,
                    },
                )
                return
            if path == "/stats":
                self._write_json(200, state.store.stats())
                return
            self._write_json(404, {"ok": False, "error": "not found"})
        except Exception as exc:
            self._write_json(500, {"ok": False, "error": str(exc)})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            state = get_state()
            body = self._read_json()
            if path == "/search":
                query = str(body.get("query") or "")
                k = int(body.get("k") or 10)
                allowlist = body.get("allowlist")
                vector = np.asarray(state.embedder.embed(query), dtype=np.float32)
                scores, ids = state.store.search(vector, k, allowlist=allowlist)
                hits = [{"vectorId": i, "score": s} for s, i in zip(scores, ids)]
                self._write_json(200, {"hits": hits})
                return
            if path == "/similar":
                # Prefer explicit query text (re-embedded semantic document from Node).
                # vector_id is only used to exclude self from results.
                query = str(body.get("query") or "")
                exclude_id = body.get("vector_id")
                k = int(body.get("k") or 10)
                allowlist = body.get("allowlist")
                if not query.strip():
                    self._write_json(400, {"ok": False, "error": "query required for similar"})
                    return
                vector = np.asarray(state.embedder.embed(query), dtype=np.float32)
                scores, ids = state.store.search(vector, k + 1, allowlist=allowlist)
                hits = []
                for s, i in zip(scores, ids):
                    if exclude_id is not None and int(i) == int(exclude_id):
                        continue
                    hits.append({"vectorId": int(i), "score": float(s)})
                    if len(hits) >= k:
                        break
                self._write_json(200, {"hits": hits})
                return
            if path == "/indexBatch":
                items = body.get("items") or []
                failed = []
                indexed = 0
                if items:
                    texts = [str(item.get("text") or "") for item in items]
                    vectors = state.embedder.embed_batch(texts)
                    arr = np.asarray(vectors, dtype=np.float32)
                    ids = [int(item["vectorId"]) for item in items]
                    try:
                        state.store.upsert(ids, arr)
                        indexed = len(ids)
                    except Exception:
                        for item, vec in zip(items, vectors):
                            try:
                                vid = int(item["vectorId"])
                                state.store.upsert(
                                    [vid], np.asarray([vec], dtype=np.float32)
                                )
                                indexed += 1
                            except Exception as item_exc:
                                failed.append(
                                    {
                                        "vectorId": int(item["vectorId"]),
                                        "error": str(item_exc),
                                    }
                                )
                self._write_json(200, {"indexed": indexed, "failed": failed})
                return
            if path == "/remove":
                ids = [int(x) for x in (body.get("vector_ids") or [])]
                removed = state.store.remove(ids)
                self._write_json(200, {"removed": removed})
                return
            if path == "/contains":
                ids = [int(x) for x in (body.get("vector_ids") or [])]
                present = []
                missing = []
                for vid in ids:
                    if state.store.contains(int(vid)):
                        present.append(int(vid))
                    else:
                        missing.append(int(vid))
                self._write_json(200, {"present": present, "missing": missing})
                return
            if path == "/sync":
                last = state.store.sync()
                self._write_json(200, {"ok": True, "lastSyncAt": last})
                return
            if path == "/rebuild":
                state.store.rebuild_empty()
                self._write_json(200, {"ok": True})
                return
            self._write_json(404, {"ok": False, "error": "not found"})
        except Exception as exc:
            traceback.print_exc()
            self._write_json(500, {"ok": False, "error": str(exc)})


def main() -> None:
    parser = argparse.ArgumentParser(
        description="GithubArchiver semantic TurboVec worker"
    )
    parser.add_argument("--host", default=env_str("SEMANTIC_WORKER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=env_int("SEMANTIC_WORKER_PORT", 8791))
    args = parser.parse_args()

    global STATE
    STATE = WorkerState()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        f"[semantic-worker] listening on http://{args.host}:{args.port} "
        f"model={STATE.model_id} dim={STATE.dimensions} bits={STATE.bit_width}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[semantic-worker] shutting down", flush=True)
        try:
            STATE.store.sync()
        finally:
            server.server_close()


if __name__ == "__main__":
    main()
