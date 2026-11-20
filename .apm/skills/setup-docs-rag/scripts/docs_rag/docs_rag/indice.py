"""Colección de Qdrant del proyecto, identificadores estables y plan de reindexado parcial."""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

QDRANT_URL = "http://localhost:6333"
EMBED_MODEL = "nomic-embed-text"
PREFIJO_DOCUMENTO = "search_document: "
PREFIJO_PREGUNTA = "search_query: "
LOTE = 32
# nomic-embed-text admite unos 2048 tokens: a partir de ~8000 caracteres el fragmento se trunca al embeberlo.
LIMITE_TRUNCADO = 8000
CAMPOS_INDICE = ("package", "version", "ecosystem")


# Sube cuando cambia el formato de los metadatos: un índice de otro formato no se reutiliza.
FORMATO = "v2"


def nombre_coleccion(raiz: Path) -> str:
    return f"docs_{FORMATO}_" + hashlib.sha1(str(Path(raiz).resolve()).lower().encode()).hexdigest()[:12]


def clave(p: dict) -> str:
    return f"{p['ecosystem']}:{p['package']}"


def id_fragmento(ecosistema: str, paquete: str, version: str, fuente: str, n: int) -> str:
    """uuid5 estable: el mismo fragmento de la misma versión tiene siempre el mismo id."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"docs-rag:{ecosistema}:{paquete}@{version}/{fuente}#{n}"))


def plan_reindexado(pedido: list[dict], actual: dict[str, dict]) -> dict[str, list[str]]:
    """Compara lo pedido con lo indexado: indexar (nuevo), reindexar (otra versión), borrar (ya no está) e igual.

    Un paquete que quedó no_docs por un fallo de red se vuelve a intentar; uno sin documentación publicada, no.
    """
    resultado = {"indexar": [], "reindexar": [], "borrar": [], "igual": []}
    pedidas = {clave(p): p for p in pedido}
    for k, p in pedidas.items():
        a = actual.get(k)
        if a is None:
            resultado["indexar"].append(k)
        elif a.get("version") != p.get("version"):
            resultado["reindexar"].append(k)
        elif a.get("status") == "no_docs" and str(a.get("reason", "")).startswith("Error al descargar"):
            resultado["reindexar"].append(k)
        else:
            resultado["igual"].append(k)
    resultado["borrar"] = [k for k in actual if k not in pedidas]
    return resultado


class IndiceQdrant:
    """Operaciones sobre la colección del proyecto. qdrant_client se importa solo al usarla."""

    def __init__(self, coleccion: str, url: str = QDRANT_URL, cliente=None):
        self.coleccion = coleccion
        if cliente is None:
            from qdrant_client import QdrantClient

            cliente = QdrantClient(url=url, timeout=120)
        self.cliente = cliente

    def asegurar(self, dimension: int) -> None:
        from qdrant_client.models import Distance, PayloadSchemaType, VectorParams

        if not self.cliente.collection_exists(self.coleccion):
            self.cliente.create_collection(self.coleccion, vectors_config=VectorParams(size=dimension, distance=Distance.COSINE))
            for campo in CAMPOS_INDICE:
                self.cliente.create_payload_index(self.coleccion, campo, field_schema=PayloadSchemaType.KEYWORD, wait=True)

    def existe(self) -> bool:
        return self.cliente.collection_exists(self.coleccion)

    def borrar_paquete(self, ecosistema: str, paquete: str) -> None:
        from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue

        if not self.existe():
            return
        filtro = Filter(must=[FieldCondition(key="ecosystem", match=MatchValue(value=ecosistema)), FieldCondition(key="package", match=MatchValue(value=paquete))])
        self.cliente.delete(self.coleccion, points_selector=FilterSelector(filter=filtro), wait=True)

    def subir(self, puntos: list[dict]) -> None:
        from qdrant_client.models import PointStruct

        for i in range(0, len(puntos), 256):
            lote = [PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"]) for p in puntos[i : i + 256]]
            self.cliente.upsert(self.coleccion, points=lote, wait=True)

    def contar(self, ecosistema: str | None = None, paquete: str | None = None) -> int:
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        condiciones = []
        if ecosistema:
            condiciones.append(FieldCondition(key="ecosystem", match=MatchValue(value=ecosistema)))
        if paquete:
            condiciones.append(FieldCondition(key="package", match=MatchValue(value=paquete)))
        return self.cliente.count(self.coleccion, count_filter=Filter(must=condiciones) if condiciones else None, exact=True).count

    def borrar_coleccion(self) -> bool:
        if self.existe():
            self.cliente.delete_collection(self.coleccion)
            return True
        return False


class EmbebedorOllama:
    """nomic-embed-text en Ollama, con su prefijo de documento o de pregunta."""

    def __init__(self, modelo: str = EMBED_MODEL, cliente=None):
        if cliente is None:
            import ollama

            cliente = ollama.Client()
        self.cliente = cliente
        self.modelo = modelo

    def documentos(self, textos: list[str]) -> list[list[float]]:
        vectores: list[list[float]] = []
        for i in range(0, len(textos), LOTE):
            r = self.cliente.embed(model=self.modelo, input=[PREFIJO_DOCUMENTO + t for t in textos[i : i + LOTE]])
            vectores += [list(v) for v in r["embeddings"]]
        return vectores

    def pregunta(self, texto: str) -> list[float]:
        return list(self.cliente.embed(model=self.modelo, input=[PREFIJO_PREGUNTA + texto])["embeddings"][0])
