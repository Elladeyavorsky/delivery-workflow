"""Consulta del índice: resolve_package y query_docs (receta del informe en docs/research/).

20 candidatos de Qdrant filtrados por paquete, reordenados con MiniLM-L6, y los 4 mejores. Si los
filtros opcionales no dejan ningún candidato con puntuación >= 0,0, se repite sin ellos dentro del
mismo paquete. Los modelos se cargan en la primera consulta.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .store import QDRANT_URL, OllamaEmbedder
from .profiles import BOOLEANS

RERANKER = "cross-encoder/ms-marco-MiniLM-L-6-v2"
CANDIDATES = 20
K = 4
THRESHOLD = 0.0
INVENTORY = Path(".docs-rag") / "inventory.json"


class NoIndex(Exception):
    pass


class InvalidQuery(Exception):
    pass


def find_root(start: Path) -> Path | None:
    """Carpeta del proyecto con .docs-rag/inventory.json, mirando desde `inicio` hacia arriba."""
    current = Path(start).resolve()
    for folder in (current, *current.parents):
        if (folder / INVENTORY).is_file():
            return folder
    return None


def load_inventory(root: Path | None, start: Path) -> dict:
    if root is None:
        raise NoIndex(
            f"No hay índice de documentación en este proyecto (se buscó {INVENTORY.as_posix()} desde {Path(start).resolve()} hacia arriba). "
            "Créalo con la skill /setup-docs-rag. Mientras tanto, no uses APIs que no puedas confirmar y dilo al cerrar."
        )
    try:
        return json.loads((root / INVENTORY).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise NoIndex(f"{INVENTORY.as_posix()} no se puede leer ({e}). Vuelve a lanzar /setup-docs-rag.") from e


def _normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name.strip().lower())


class QdrantSearcher:
    def __init__(self, collection: str, url: str = QDRANT_URL, client=None):
        self.collection = collection
        if client is None:
            from qdrant_client import QdrantClient

            client = QdrantClient(url=url, timeout=60)
        self.client = client

    def search(self, vector: list[float], conditions: dict, limit: int) -> list[dict]:
        from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue

        must = []
        for field_name, field_value in conditions.items():
            if isinstance(field_value, bool):
                must.append(FieldCondition(key=field_name, match=MatchValue(value=field_value)))
            elif isinstance(field_value, list):
                must.append(FieldCondition(key=field_name, match=MatchAny(any=field_value)))
            else:
                must.append(FieldCondition(key=field_name, match=MatchValue(value=field_value)))
        points = self.client.query_points(self.collection, query=vector, limit=limit, query_filter=Filter(must=must), with_payload=True).points
        return [{**(p.payload or {}), "vector_score": float(p.score)} for p in points]


class MiniLMReranker:
    def __init__(self, model_name: str = RERANKER):
        from sentence_transformers import CrossEncoder

        self.model_name = CrossEncoder(model_name)

    def score_pairs(self, question: str, texts: list[str]) -> list[float]:
        return [float(s) for s in self.model_name.predict([(question, t) for t in texts])]


class DocsLookup:
    """Lee el inventario del proyecto en cada llamada (puede cambiar al reindexar) y carga los modelos una vez."""

    def __init__(self, start: Path, *, searcher=None, embedder=None, reranker=None):
        self.start = Path(start)
        self._searcher = searcher
        self._embedder = embedder
        self._reranker = reranker

    def _inventory(self) -> dict:
        return load_inventory(find_root(self.start), self.start)

    def resolve_package(self, name: str) -> dict:
        inv = self._inventory()
        wanted_name = _normalize(name.split(":", 1)[-1])
        packages = list(inv.get("packages", {}).values())
        exact_matches = [p for p in packages if _normalize(p["package"]) == wanted_name]
        candidates = exact_matches or [p for p in packages if wanted_name in _normalize(p["package"]) or _normalize(p["package"]) in wanted_name]
        if ":" in name:
            eco = name.split(":", 1)[0]
            candidates = [p for p in candidates if p["ecosystem"] == eco]
        result = []
        for p in candidates:
            r = {"package": f"{p['ecosystem']}:{p['package']}", "name": p["package"], "version": p["version"], "ecosystem": p["ecosystem"], "status": p.get("status")}
            if p.get("status") == "indexed":
                r.update({"doc_type": p.get("doc_type"), "filters": p.get("filters", []), "chunks": p.get("chunks")})
            else:
                r["no_docs"] = p.get("reason", "Sin documentación.")
            result.append(r)
        if not result:
            available = sorted(f"{p['ecosystem']}:{p['package']}" for p in packages)
            return {"packages": [], "warning": f"«{name}» no está en el índice de este proyecto. Indexados: {', '.join(available) or 'ninguno'}."}
        return {"packages": result}

    def _package(self, inv: dict, package: str) -> dict:
        all_items = inv.get("packages", {})
        if package in all_items:
            return all_items[package]
        matches = [p for p in all_items.values() if _normalize(p["package"]) == _normalize(package)]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            options = ", ".join(f"{p['ecosystem']}:{p['package']}" for p in matches)
            raise InvalidQuery(f"«{package}» está en varios ecosistemas: usa uno de {options}.")
        raise InvalidQuery(f"«{package}» no está en el índice. Llama antes a resolve_package.")

    def _validate_filters(self, p: dict, filters: dict | None) -> dict:
        if not filters:
            return {}
        valid = set(p.get("filters", []))
        invalid = [c for c in filters if c not in valid]
        if invalid:
            raise InvalidQuery(f"Filtros no válidos para {p['package']} ({p.get('doc_type')}): {', '.join(invalid)}. Válidos: {', '.join(sorted(valid)) or 'ninguno'}.")
        cleaned_files = {}
        for field_name, field_value in filters.items():
            if field_name in BOOLEANS:
                if not isinstance(field_value, bool):
                    raise InvalidQuery(f"El filtro {field_name} es verdadero o falso.")
                cleaned_files[field_name] = field_value
            elif isinstance(field_value, str) and field_value:
                cleaned_files[field_name] = [field_value]
            elif isinstance(field_value, list) and field_value and all(isinstance(v, str) and v for v in field_value):
                cleaned_files[field_name] = field_value
            else:
                raise InvalidQuery(f"El filtro {field_name} necesita un texto o una lista de textos.")
        return cleaned_files

    def query_docs(self, package: str, question: str, filters: dict | None = None, k: int = K) -> dict:
        if not question or not question.strip():
            raise InvalidQuery("La pregunta no puede estar vacía.")
        if not 1 <= k <= CANDIDATES:
            raise InvalidQuery(f"k va de 1 a {CANDIDATES}.")
        inv = self._inventory()
        p = self._package(inv, package)
        if p.get("status") != "indexed":
            raise InvalidQuery(f"{p['package']} {p['version']} no tiene documentación indexada: {p.get('reason', 'no_docs')}.")
        extra = self._validate_filters(p, filters)
        if self._searcher is None:
            self._searcher = QdrantSearcher(inv["collection"])
        if self._embedder is None:
            self._embedder = OllamaEmbedder()
        if self._reranker is None:
            self._reranker = MiniLMReranker()
        vector = self._embedder.question(question)
        base = {"ecosystem": p["ecosystem"], "package": p["package"]}
        results = self._rerank(question, self._searcher.search(vector, {**base, **extra}, CANDIDATES))
        filtered = bool(extra)
        if extra and not any(r["rerank_score"] >= THRESHOLD for r in results):
            results = self._rerank(question, self._searcher.search(vector, base, CANDIDATES))
            filtered = False
        return {"package": f"{p['ecosystem']}:{p['package']}", "version": p["version"], "doc_type": p.get("doc_type"), "filtered": filtered, "results": results[:k]}

    def _rerank(self, question: str, candidates: list[dict]) -> list[dict]:
        if not candidates:
            return []
        scores = self._reranker.score_pairs(question, [c["text"] for c in candidates])
        for c, s in zip(candidates, scores):
            c["rerank_score"] = s
        return sorted(candidates, key=lambda c: c["rerank_score"], reverse=True)
