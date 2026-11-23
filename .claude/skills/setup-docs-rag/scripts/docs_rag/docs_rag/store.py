"""Colección de Qdrant del proyecto, identificadores estables y plan de reindexado parcial."""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

QDRANT_URL = "http://localhost:6333"
EMBED_MODEL = "nomic-embed-text"
DOCUMENT_PREFIX = "search_document: "
QUERY_PREFIX = "search_query: "
BATCH_SIZE = 32
# nomic-embed-text admite unos 2048 tokens: a partir de ~8000 caracteres el fragmento se trunca al embeberlo.
TRUNCATE_LIMIT = 8000
INDEXED_FIELDS = ("package", "version", "ecosystem")


# Sube cuando cambia el formato de los metadatos: un índice de otro formato no se reutiliza.
FORMAT = "v2"


def collection_name(root: Path) -> str:
    return f"docs_{FORMAT}_" + hashlib.sha1(str(Path(root).resolve()).lower().encode()).hexdigest()[:12]


def package_key(p: dict) -> str:
    return f"{p['ecosystem']}:{p['package']}"


def chunk_id(ecosystem: str, package: str, version: str, source: str, n: int) -> str:
    """uuid5 estable: el mismo fragmento de la misma versión tiene siempre el mismo id."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"docs-rag:{ecosystem}:{package}@{version}/{source}#{n}"))


def reindex_plan(requested: list[dict], current: dict[str, dict]) -> dict[str, list[str]]:
    """Compara lo pedido con lo indexado: index (nuevo), reindex (otra versión), delete (ya no está) y unchanged.

    Un paquete que quedó no_docs por un fallo de red se vuelve a intentar; uno sin documentación publicada, no.
    """
    result = {"index": [], "reindex": [], "delete": [], "unchanged": []}
    requested_keys = {package_key(p): p for p in requested}
    for k, p in requested_keys.items():
        a = current.get(k)
        if a is None:
            result["index"].append(k)
        elif a.get("version") != p.get("version"):
            result["reindex"].append(k)
        elif a.get("status") == "no_docs" and str(a.get("reason", "")).startswith("Error al descargar"):
            result["reindex"].append(k)
        else:
            result["unchanged"].append(k)
    result["delete"] = [k for k in current if k not in requested_keys]
    return result


class QdrantStore:
    """Operaciones sobre la colección del proyecto. qdrant_client se importa solo al usarla."""

    def __init__(self, collection: str, url: str = QDRANT_URL, client=None):
        self.collection = collection
        if client is None:
            from qdrant_client import QdrantClient

            client = QdrantClient(url=url, timeout=120)
        self.client = client

    def ensure(self, dimension: int) -> None:
        from qdrant_client.models import Distance, PayloadSchemaType, VectorParams

        if not self.client.collection_exists(self.collection):
            self.client.create_collection(self.collection, vectors_config=VectorParams(size=dimension, distance=Distance.COSINE))
            for field_name in INDEXED_FIELDS:
                self.client.create_payload_index(self.collection, field_name, field_schema=PayloadSchemaType.KEYWORD, wait=True)

    def has_collection(self) -> bool:
        return self.client.collection_exists(self.collection)

    def delete_package(self, ecosystem: str, package: str) -> None:
        from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue

        if not self.has_collection():
            return
        filter_value = Filter(must=[FieldCondition(key="ecosystem", match=MatchValue(value=ecosystem)), FieldCondition(key="package", match=MatchValue(value=package))])
        self.client.delete(self.collection, points_selector=FilterSelector(filter=filter_value), wait=True)

    def upload(self, points: list[dict]) -> None:
        from qdrant_client.models import PointStruct

        for i in range(0, len(points), 256):
            batch = [PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"]) for p in points[i : i + 256]]
            self.client.upsert(self.collection, points=batch, wait=True)

    def count_chunks(self, ecosystem: str | None = None, package: str | None = None) -> int:
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        conditions = []
        if ecosystem:
            conditions.append(FieldCondition(key="ecosystem", match=MatchValue(value=ecosystem)))
        if package:
            conditions.append(FieldCondition(key="package", match=MatchValue(value=package)))
        return self.client.count(self.collection, count_filter=Filter(must=conditions) if conditions else None, exact=True).count

    def drop_collection(self) -> bool:
        if self.has_collection():
            self.client.delete_collection(self.collection)
            return True
        return False


class OllamaEmbedder:
    """nomic-embed-text en Ollama, con su prefijo de documento o de pregunta."""

    def __init__(self, model_name: str = EMBED_MODEL, client=None):
        if client is None:
            import ollama

            client = ollama.Client()
        self.client = client
        self.model_name = model_name

    def documents(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for i in range(0, len(texts), BATCH_SIZE):
            r = self.client.embed(model=self.model_name, input=[DOCUMENT_PREFIX + t for t in texts[i : i + BATCH_SIZE]])
            vectors += [list(v) for v in r["embeddings"]]
        return vectors

    def question(self, text: str) -> list[float]:
        return list(self.client.embed(model=self.model_name, input=[QUERY_PREFIX + text])["embeddings"][0])
