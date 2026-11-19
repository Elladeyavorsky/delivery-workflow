"""Consulta del índice: resolver_paquete y consultar_docs (receta del informe en docs/research/).

20 candidatos de Qdrant filtrados por paquete, reordenados con MiniLM-L6, y los 4 mejores. Si los
filtros opcionales no dejan ningún candidato con puntuación >= 0,0, se repite sin ellos dentro del
mismo paquete. Los modelos se cargan en la primera consulta.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .indice import QDRANT_URL, EmbebedorOllama
from .perfiles import BOOLEANOS

RERANKER = "cross-encoder/ms-marco-MiniLM-L-6-v2"
CANDIDATOS = 20
K = 4
UMBRAL = 0.0
INVENTARIO = Path(".docs-rag") / "inventario.json"


class SinIndice(Exception):
    pass


class ConsultaNoValida(Exception):
    pass


def buscar_raiz(inicio: Path) -> Path | None:
    """Carpeta del proyecto con .docs-rag/inventario.json, mirando desde `inicio` hacia arriba."""
    actual = Path(inicio).resolve()
    for carpeta in (actual, *actual.parents):
        if (carpeta / INVENTARIO).is_file():
            return carpeta
    return None


def cargar_inventario(raiz: Path | None, inicio: Path) -> dict:
    if raiz is None:
        raise SinIndice(
            f"No hay índice de documentación en este proyecto (se buscó {INVENTARIO.as_posix()} desde {Path(inicio).resolve()} hacia arriba). "
            "Créalo con la skill /setup-docs-rag. Mientras tanto, no uses APIs que no puedas confirmar y dilo al cerrar."
        )
    try:
        return json.loads((raiz / INVENTARIO).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise SinIndice(f"{INVENTARIO.as_posix()} no se puede leer ({e}). Vuelve a lanzar /setup-docs-rag.") from e


def _normalizar(nombre: str) -> str:
    return re.sub(r"[-_.]+", "-", nombre.strip().lower())


class BuscadorQdrant:
    def __init__(self, coleccion: str, url: str = QDRANT_URL, cliente=None):
        self.coleccion = coleccion
        if cliente is None:
            from qdrant_client import QdrantClient

            cliente = QdrantClient(url=url, timeout=60)
        self.cliente = cliente

    def buscar(self, vector: list[float], condiciones: dict, limite: int) -> list[dict]:
        from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue

        must = []
        for campo, valor in condiciones.items():
            if isinstance(valor, bool):
                must.append(FieldCondition(key=campo, match=MatchValue(value=valor)))
            elif isinstance(valor, list):
                must.append(FieldCondition(key=campo, match=MatchAny(any=valor)))
            else:
                must.append(FieldCondition(key=campo, match=MatchValue(value=valor)))
        puntos = self.cliente.query_points(self.coleccion, query=vector, limit=limite, query_filter=Filter(must=must), with_payload=True).points
        return [{**(p.payload or {}), "score_vectorial": float(p.score)} for p in puntos]


class ReordenadorMiniLM:
    def __init__(self, modelo: str = RERANKER):
        from sentence_transformers import CrossEncoder

        self.modelo = CrossEncoder(modelo)

    def puntuar(self, pregunta: str, textos: list[str]) -> list[float]:
        return [float(s) for s in self.modelo.predict([(pregunta, t) for t in textos])]


class Consultor:
    """Lee el inventario del proyecto en cada llamada (puede cambiar al reindexar) y carga los modelos una vez."""

    def __init__(self, inicio: Path, *, buscador=None, embebedor=None, reordenador=None):
        self.inicio = Path(inicio)
        self._buscador = buscador
        self._embebedor = embebedor
        self._reordenador = reordenador

    def _inventario(self) -> dict:
        return cargar_inventario(buscar_raiz(self.inicio), self.inicio)

    def resolver_paquete(self, nombre: str) -> dict:
        inv = self._inventario()
        buscado = _normalizar(nombre.split(":", 1)[-1])
        paquetes = list(inv.get("paquetes", {}).values())
        exactos = [p for p in paquetes if _normalizar(p["paquete"]) == buscado]
        candidatos = exactos or [p for p in paquetes if buscado in _normalizar(p["paquete"]) or _normalizar(p["paquete"]) in buscado]
        if ":" in nombre:
            eco = nombre.split(":", 1)[0]
            candidatos = [p for p in candidatos if p["ecosistema"] == eco]
        resultado = []
        for p in candidatos:
            r = {"paquete": f"{p['ecosistema']}:{p['paquete']}", "nombre": p["paquete"], "version": p["version"], "ecosistema": p["ecosistema"], "estado": p.get("estado")}
            if p.get("estado") == "indexado":
                r.update({"tipo_doc": p.get("tipo_doc"), "filtros": p.get("filtros", []), "fragmentos": p.get("fragmentos")})
            else:
                r["sin_doc"] = p.get("motivo", "Sin documentación.")
            resultado.append(r)
        if not resultado:
            disponibles = sorted(f"{p['ecosistema']}:{p['paquete']}" for p in paquetes)
            return {"paquetes": [], "aviso": f"«{nombre}» no está en el índice de este proyecto. Indexados: {', '.join(disponibles) or 'ninguno'}."}
        return {"paquetes": resultado}

    def _paquete(self, inv: dict, paquete: str) -> dict:
        todos = inv.get("paquetes", {})
        if paquete in todos:
            return todos[paquete]
        coincidencias = [p for p in todos.values() if _normalizar(p["paquete"]) == _normalizar(paquete)]
        if len(coincidencias) == 1:
            return coincidencias[0]
        if len(coincidencias) > 1:
            opciones = ", ".join(f"{p['ecosistema']}:{p['paquete']}" for p in coincidencias)
            raise ConsultaNoValida(f"«{paquete}» está en varios ecosistemas: usa uno de {opciones}.")
        raise ConsultaNoValida(f"«{paquete}» no está en el índice. Llama antes a resolver_paquete.")

    def _validar_filtros(self, p: dict, filtros: dict | None) -> dict:
        if not filtros:
            return {}
        validos = set(p.get("filtros", []))
        malos = [c for c in filtros if c not in validos]
        if malos:
            raise ConsultaNoValida(f"Filtros no válidos para {p['paquete']} ({p.get('tipo_doc')}): {', '.join(malos)}. Válidos: {', '.join(sorted(validos)) or 'ninguno'}.")
        limpios = {}
        for campo, valor in filtros.items():
            if campo in BOOLEANOS:
                if not isinstance(valor, bool):
                    raise ConsultaNoValida(f"El filtro {campo} es verdadero o falso.")
                limpios[campo] = valor
            elif isinstance(valor, str) and valor:
                limpios[campo] = [valor]
            elif isinstance(valor, list) and valor and all(isinstance(v, str) and v for v in valor):
                limpios[campo] = valor
            else:
                raise ConsultaNoValida(f"El filtro {campo} necesita un texto o una lista de textos.")
        return limpios

    def consultar_docs(self, paquete: str, pregunta: str, filtros: dict | None = None, k: int = K) -> dict:
        if not pregunta or not pregunta.strip():
            raise ConsultaNoValida("La pregunta no puede estar vacía.")
        if not 1 <= k <= CANDIDATOS:
            raise ConsultaNoValida(f"k va de 1 a {CANDIDATOS}.")
        inv = self._inventario()
        p = self._paquete(inv, paquete)
        if p.get("estado") != "indexado":
            raise ConsultaNoValida(f"{p['paquete']} {p['version']} no tiene documentación indexada: {p.get('motivo', 'sin_doc')}.")
        extra = self._validar_filtros(p, filtros)
        if self._buscador is None:
            self._buscador = BuscadorQdrant(inv["coleccion"])
        if self._embebedor is None:
            self._embebedor = EmbebedorOllama()
        if self._reordenador is None:
            self._reordenador = ReordenadorMiniLM()
        vector = self._embebedor.pregunta(pregunta)
        base = {"ecosistema": p["ecosistema"], "paquete": p["paquete"]}
        resultados = self._reordenar(pregunta, self._buscador.buscar(vector, {**base, **extra}, CANDIDATOS))
        filtrado = bool(extra)
        if extra and not any(r["score_reranking"] >= UMBRAL for r in resultados):
            resultados = self._reordenar(pregunta, self._buscador.buscar(vector, base, CANDIDATOS))
            filtrado = False
        return {"paquete": f"{p['ecosistema']}:{p['paquete']}", "version": p["version"], "tipo_doc": p.get("tipo_doc"), "filtrado": filtrado, "resultados": resultados[:k]}

    def _reordenar(self, pregunta: str, candidatos: list[dict]) -> list[dict]:
        if not candidatos:
            return []
        puntos = self._reordenador.puntuar(pregunta, [c["texto"] for c in candidatos])
        for c, s in zip(candidatos, puntos):
            c["score_reranking"] = s
        return sorted(candidatos, key=lambda c: c["score_reranking"], reverse=True)
