"""TurboVec IdMapIndex persistence with atomic metadata manifest."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

try:
    from turbovec import IdMapIndex
except ImportError as exc:  # pragma: no cover
    raise RuntimeError("turbovec is required: pip install turbovec") from exc


@dataclass
class IndexManifest:
    schema_version: int
    semantic_document_version: int
    embedding_model: str
    dimensions: int
    quantization_bits: int
    last_sync_at: Optional[str] = None
    indexed_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "semanticDocumentVersion": self.semantic_document_version,
            "embeddingModel": self.embedding_model,
            "dimensions": self.dimensions,
            "quantizationBits": self.quantization_bits,
            "lastSyncAt": self.last_sync_at,
            "indexedCount": self.indexed_count,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "IndexManifest":
        return cls(
            schema_version=int(data["schemaVersion"]),
            semantic_document_version=int(data["semanticDocumentVersion"]),
            embedding_model=str(data["embeddingModel"]),
            dimensions=int(data["dimensions"]),
            quantization_bits=int(data["quantizationBits"]),
            last_sync_at=data.get("lastSyncAt"),
            indexed_count=int(data.get("indexedCount") or 0),
        )


class SemanticIndexStore:
    def __init__(
        self,
        index_path: str,
        *,
        dimensions: int,
        bit_width: int,
        embedding_model: str,
        schema_version: int,
        semantic_document_version: int,
    ):
        self.index_path = Path(index_path)
        self.manifest_path = self.index_path.with_suffix(self.index_path.suffix + ".meta.json")
        self.dimensions = dimensions
        self.bit_width = bit_width
        self.embedding_model = embedding_model
        self.schema_version = schema_version
        self.semantic_document_version = semantic_document_version
        self._lock = threading.RLock()
        self._index: IdMapIndex
        self._manifest: IndexManifest
        self._load_or_create()

    def _load_or_create(self) -> None:
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        if self.index_path.exists() and self.manifest_path.exists():
            manifest = IndexManifest.from_dict(
                json.loads(self.manifest_path.read_text(encoding="utf-8"))
            )
            self._validate_manifest(manifest)
            self._index = IdMapIndex.load(str(self.index_path))
            if int(self._index.dim) != self.dimensions:
                raise RuntimeError(
                    f"TurboVec index dim={self._index.dim} incompatible with "
                    f"configured dimensions={self.dimensions}. Rebuild required."
                )
            if int(self._index.bit_width) != self.bit_width:
                raise RuntimeError(
                    f"TurboVec bit_width={self._index.bit_width} incompatible with "
                    f"configured SEMANTIC_VECTOR_BITS={self.bit_width}. Rebuild required."
                )
            self._manifest = manifest
            return

        if self.index_path.exists() or self.manifest_path.exists():
            raise RuntimeError(
                "Incomplete semantic index on disk (missing .tvim or .meta.json). "
                "Delete both and rebuild, or restore from backup."
            )

        self._index = IdMapIndex(dim=self.dimensions, bit_width=self.bit_width)
        self._manifest = IndexManifest(
            schema_version=self.schema_version,
            semantic_document_version=self.semantic_document_version,
            embedding_model=self.embedding_model,
            dimensions=self.dimensions,
            quantization_bits=self.bit_width,
            indexed_count=0,
        )
        self.sync()

    def _validate_manifest(self, manifest: IndexManifest) -> None:
        if manifest.schema_version != self.schema_version:
            raise RuntimeError(
                f"Index schemaVersion={manifest.schema_version} != "
                f"configured {self.schema_version}. Explicit rebuild required."
            )
        if manifest.embedding_model != self.embedding_model:
            raise RuntimeError(
                f"Index embeddingModel={manifest.embedding_model!r} != "
                f"configured {self.embedding_model!r}. Explicit rebuild required."
            )
        if manifest.dimensions != self.dimensions:
            raise RuntimeError(
                f"Index dimensions={manifest.dimensions} != configured {self.dimensions}. "
                "Explicit rebuild required."
            )
        if manifest.quantization_bits != self.bit_width:
            raise RuntimeError(
                f"Index quantizationBits={manifest.quantization_bits} != "
                f"configured {self.bit_width}. Explicit rebuild required."
            )
        if manifest.semantic_document_version != self.semantic_document_version:
            # Document version drift is recoverable via reindex without full file wipe,
            # but refuse silent mixing of incompatible document formulas in one index.
            raise RuntimeError(
                f"Index semanticDocumentVersion={manifest.semantic_document_version} != "
                f"configured {self.semantic_document_version}. Rebuild or reindex required."
            )

    def sync(self) -> str:
        with self._lock:
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            self._manifest.last_sync_at = now
            self._manifest.indexed_count = int(getattr(self._index, "len", lambda: 0)() or 0)
            # turbovec may expose __len__
            try:
                self._manifest.indexed_count = len(self._index)  # type: ignore[arg-type]
            except Exception:
                pass
            self._index.sync(str(self.index_path))
            self._atomic_write_manifest(self._manifest)
            return now

    def _atomic_write_manifest(self, manifest: IndexManifest) -> None:
        payload = json.dumps(manifest.to_dict(), indent=2, sort_keys=True)
        directory = self.manifest_path.parent
        fd, tmp_name = tempfile.mkstemp(prefix=".semantic-meta-", dir=str(directory))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, self.manifest_path)
        finally:
            if os.path.exists(tmp_name):
                try:
                    os.unlink(tmp_name)
                except OSError:
                    pass

    def rebuild_empty(self) -> None:
        with self._lock:
            for path in (self.index_path, self.manifest_path):
                if path.exists():
                    path.unlink()
            self._index = IdMapIndex(dim=self.dimensions, bit_width=self.bit_width)
            self._manifest = IndexManifest(
                schema_version=self.schema_version,
                semantic_document_version=self.semantic_document_version,
                embedding_model=self.embedding_model,
                dimensions=self.dimensions,
                quantization_bits=self.bit_width,
                indexed_count=0,
            )
            self.sync()

    def upsert(self, vector_ids: Sequence[int], vectors: np.ndarray) -> None:
        if vectors.dtype != np.float32:
            vectors = np.asarray(vectors, dtype=np.float32)
        if vectors.ndim != 2 or vectors.shape[1] != self.dimensions:
            raise ValueError(
                f"Expected vectors shape (n, {self.dimensions}), got {vectors.shape}"
            )
        ids = np.asarray(list(vector_ids), dtype=np.uint64)
        with self._lock:
            for vid in ids.tolist():
                if self._index.contains(int(vid)):
                    self._index.remove(int(vid))
            self._index.add_with_ids(vectors, ids)

    def remove(self, vector_ids: Sequence[int]) -> int:
        removed = 0
        with self._lock:
            for vid in vector_ids:
                if self._index.contains(int(vid)):
                    self._index.remove(int(vid))
                    removed += 1
        return removed

    def search(
        self,
        query: np.ndarray,
        k: int,
        allowlist: Optional[Sequence[int]] = None,
    ) -> Tuple[List[float], List[int]]:
        if query.dtype != np.float32:
            query = np.asarray(query, dtype=np.float32)
        if query.ndim == 1:
            query = query.reshape(1, -1)
        if query.shape[1] != self.dimensions:
            raise ValueError(
                f"Query dim {query.shape[1]} != index dim {self.dimensions}"
            )
        kwargs: Dict[str, Any] = {}
        if allowlist is not None:
            kwargs["allowlist"] = np.asarray(list(allowlist), dtype=np.uint64)
        with self._lock:
            scores, ids = self._index.search(query, int(k), **kwargs)
        # turbovec returns 2-D arrays for batched queries
        score_row = np.asarray(scores[0] if np.asarray(scores).ndim == 2 else scores).tolist()
        id_row = np.asarray(ids[0] if np.asarray(ids).ndim == 2 else ids).tolist()
        return [float(s) for s in score_row], [int(i) for i in id_row]

    def contains(self, vector_id: int) -> bool:
        with self._lock:
            return bool(self._index.contains(int(vector_id)))

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            indexed = 0
            try:
                indexed = len(self._index)  # type: ignore[arg-type]
            except Exception:
                indexed = self._manifest.indexed_count
            index_bytes = self.index_path.stat().st_size if self.index_path.exists() else None
            return {
                "ok": True,
                "indexedCount": indexed,
                "dimensions": self.dimensions,
                "vectorBits": self.bit_width,
                "modelId": self.embedding_model,
                "indexPath": str(self.index_path),
                "indexBytes": index_bytes,
                "lastSyncAt": self._manifest.last_sync_at,
                "schemaVersion": self.schema_version,
                "semanticDocumentVersion": self.semantic_document_version,
            }
