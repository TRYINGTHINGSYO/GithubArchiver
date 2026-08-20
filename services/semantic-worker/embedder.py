"""Deterministic local embedders for the GithubArchiver semantic worker."""

from __future__ import annotations

import hashlib
import math
import re
from abc import ABC, abstractmethod
from typing import Iterable, List, Sequence


TOKEN_RE = re.compile(r"[a-z0-9_]+", re.IGNORECASE)


class EmbeddingProvider(ABC):
    @property
    @abstractmethod
    def model_id(self) -> str: ...

    @property
    @abstractmethod
    def dimensions(self) -> int: ...

    @abstractmethod
    def embed(self, text: str) -> List[float]: ...

    def embed_batch(self, texts: Sequence[str]) -> List[List[float]]:
        return [self.embed(t) for t in texts]


def _l2_normalize(vec: List[float]) -> List[float]:
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


class HashingEmbeddingProvider(EmbeddingProvider):
    """
    Deterministic CI/test embedder — NOT true semantic understanding.

    Character + token n-grams are hashed into a fixed-width bag and L2-normalized.
    Use this for offline tests and smoke checks only. Production retrieval must
    use sentence-transformers (see requirements-prod.txt).
    """

    def __init__(self, dimensions: int = 384, model_id: str = "hashing-v1"):
        if dimensions < 32:
            raise ValueError("dimensions must be >= 32")
        self._dimensions = dimensions
        self._model_id = model_id

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def _accumulate(self, vec: List[float], token: str, weight: float = 1.0) -> None:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        idx = int.from_bytes(digest[:4], "little") % self._dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vec[idx] += sign * weight

    def embed(self, text: str) -> List[float]:
        vec = [0.0] * self._dimensions
        lowered = (text or "").lower()
        tokens = TOKEN_RE.findall(lowered)
        for tok in tokens:
            self._accumulate(vec, f"t:{tok}", 1.0)
            if len(tok) >= 3:
                for i in range(len(tok) - 2):
                    self._accumulate(vec, f"c3:{tok[i:i+3]}", 0.35)
        # character bigrams over the whole string for short descriptions
        compact = re.sub(r"\s+", " ", lowered)[:2000]
        for i in range(max(0, len(compact) - 1)):
            self._accumulate(vec, f"b:{compact[i:i+2]}", 0.15)
        return _l2_normalize(vec)


class SentenceTransformerProvider(EmbeddingProvider):
    def __init__(self, model_name: str, dimensions: int | None = None):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "sentence-transformers is not installed. "
                "pip install -r services/semantic-worker/requirements.txt"
            ) from exc
        self._model_name = model_name
        self._model = SentenceTransformer(model_name)
        probe = self._model.encode(["dimension probe"], normalize_embeddings=True)
        self._dimensions = int(probe.shape[1])
        if dimensions is not None and dimensions != self._dimensions:
            raise RuntimeError(
                f"Configured SEMANTIC_EMBEDDING_DIMS={dimensions} but model "
                f"{model_name} produces {self._dimensions}"
            )

    @property
    def model_id(self) -> str:
        return self._model_name

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def embed(self, text: str) -> List[float]:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: Sequence[str]) -> List[List[float]]:
        import numpy as np

        arr = self._model.encode(
            list(texts),
            normalize_embeddings=True,
            convert_to_numpy=True,
        )
        arr = np.asarray(arr, dtype=np.float32)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        if arr.shape[1] != self._dimensions:
            raise RuntimeError(
                f"Embedding dimension mismatch: expected {self._dimensions}, got {arr.shape[1]}"
            )
        return arr.tolist()


def create_embedder(
    provider: str,
    model_id: str,
    dimensions: int,
) -> EmbeddingProvider:
    name = (provider or "hashing").strip().lower()
    if name in {"hashing", "local-hashing"}:
        return HashingEmbeddingProvider(dimensions=dimensions, model_id=model_id or "hashing-v1")
    if name in {"sentence-transformers", "local", "minilm"}:
        return SentenceTransformerProvider(model_name=model_id, dimensions=dimensions)
    raise ValueError(f"Unknown embedding provider: {provider}")
