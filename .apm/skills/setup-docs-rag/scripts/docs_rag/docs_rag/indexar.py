"""Indexador: lleva la colección del proyecto al inventario pedido en .docs-rag/request.json.

Solo toca lo que cambió (plan_reindexado). El progreso va a stderr y el resumen JSON a stdout.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from . import fuentes
from .indice import LIMITE_TRUNCADO, EmbebedorOllama, IndiceQdrant, clave, id_fragmento, nombre_coleccion, plan_reindexado
from .limpieza import a_markdown, es_referencia, quitar_repetidas
from .perfiles import detectar_tipo, filtros_de, metadatos_fichero, metadatos_fragmento
from .troceo import trocear

RAG = ".docs-rag"
INVENTARIO = "inventory.json"
PETICION = "request.json"
# Ficheros del formato anterior, con las claves en español: se borran al migrar.
INVENTARIO_ANTERIOR = "inventario.json"
PETICION_ANTERIOR = "peticion.json"


def log(mensaje: str) -> None:
    print(mensaje, file=sys.stderr, flush=True)


def leer_token(raiz: Path) -> str | None:
    """GITHUB_TOKEN del .env del proyecto (sin ejecutarlo) o del entorno. Solo sube el límite de la API de GitHub."""
    env = raiz / ".env"
    if env.is_file():
        for linea in env.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"^\s*(?:export\s+)?GITHUB_TOKEN\s*=\s*(.*)$", linea)
            if m:
                valor = m.group(1).strip()
                q = re.match(r"^([\"'])(.*?)\1", valor)
                valor = q.group(2) if q else re.sub(r"\s+#.*$", "", valor)
                if valor:
                    return valor
    return os.environ.get("GITHUB_TOKEN") or None


def _leer_json(ruta: Path, defecto):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return defecto


def _escribir_json(ruta: Path, datos) -> None:
    tmp = ruta.with_suffix(".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(ruta)


def _carpeta_cache(k: str) -> str:
    return re.sub(r"[^\w.@-]+", "_", k)


def preparar(doc: fuentes.Documentacion) -> tuple[str, dict[str, str]]:
    """Markdown limpio de cada fichero y tipo de documentación del paquete."""
    md: dict[str, str] = {}
    for fuente, texto in doc.ficheros.items():
        nueva, contenido = a_markdown(fuente, texto)
        if es_referencia(nueva) and contenido.strip():
            md[nueva] = contenido
    md = quitar_repetidas(md)
    return detectar_tipo(md, doc.pista), md


def fragmentos_de(p: dict, tipo: str, md: dict[str, str]) -> list[dict]:
    """Fragmentos con el núcleo común y los campos del perfil, listos para embeber."""
    salida = []
    for fuente, contenido in sorted(md.items()):
        fichero = metadatos_fichero(tipo, fuente, contenido)
        for f in trocear(fuente, contenido):
            payload = {
                "package": p["package"],
                "version": p["version"],
                "ecosystem": p["ecosystem"],
                "doc_type": tipo,
                "source": fuente,
                "heading_path": f["heading_path"],
                "text": f["text"],
                **metadatos_fragmento(tipo, f["text"], fichero),
            }
            salida.append({"id": id_fragmento(p["ecosystem"], p["package"], p["version"], fuente, f["n"]), "payload": payload})
    return salida


def migrar_formato_anterior(carpeta: Path, coleccion: str, abrir_indice=IndiceQdrant) -> str | None:
    """Borra la colección y los ficheros de un índice con el formato anterior. Devuelve la colección borrada."""
    anterior = carpeta / INVENTARIO_ANTERIOR
    if not anterior.is_file():
        return None
    vieja = _leer_json(anterior, {}).get("coleccion")
    if vieja and vieja != coleccion:
        abrir_indice(vieja).borrar_coleccion()
    anterior.unlink()
    (carpeta / PETICION_ANTERIOR).unlink(missing_ok=True)
    return vieja


def ejecutar(raiz: Path, *, http=fuentes.http_real, indice=None, embebedor=None, token: str | None = None, abrir_indice=IndiceQdrant) -> dict:
    raiz = Path(raiz).resolve()
    carpeta = raiz / RAG
    carpeta.mkdir(exist_ok=True)
    peticion = _leer_json(carpeta / PETICION, None)
    if peticion is None:
        raise SystemExit(f"No hay {RAG}/{PETICION}: lanza antes setup-docs-rag apply.")
    coleccion = nombre_coleccion(raiz)
    vieja = migrar_formato_anterior(carpeta, coleccion, abrir_indice)
    if vieja is not None:
        log(f"índice del formato anterior borrado ({vieja}): se indexa de nuevo en {coleccion}")
    inventario = _leer_json(carpeta / INVENTARIO, {"collection": coleccion, "packages": {}})
    inventario["collection"] = coleccion
    actual = inventario.setdefault("packages", {})
    indice = indice or IndiceQdrant(coleccion)
    plan = plan_reindexado(peticion["packages"], actual)
    pedidas = {clave(p): p for p in peticion["packages"]}
    resumen = {"collection": coleccion, "indexed": [], "reindexed": [], "deleted": [], "unchanged": plan["igual"], "no_docs": [], "warnings": [], "chunks": 0}
    if vieja is not None:
        resumen["warnings"].append(f"El índice anterior ({vieja}) tenía los metadatos en español: se ha borrado y se indexa todo de nuevo.")

    for k in plan["borrar"]:
        a = actual.pop(k)
        indice.borrar_paquete(a["ecosystem"], a["package"])
        resumen["deleted"].append(k)
        log(f"borrado {k}")
    _escribir_json(carpeta / INVENTARIO, inventario)

    trabajo = [(k, "indexed") for k in plan["indexar"]] + [(k, "reindexed") for k in plan["reindexar"]]
    for n, (k, lista) in enumerate(trabajo, 1):
        p = pedidas[k]
        log(f"[{n}/{len(trabajo)}] {k} {p['version']}: descargando documentación…")
        doc = fuentes.documentar(p["package"], p["ecosystem"], p["version"], http=http, token=token)
        resumen["warnings"] += doc.avisos
        if k in actual:
            indice.borrar_paquete(p["ecosystem"], p["package"])
        base = {"package": p["package"], "ecosystem": p["ecosystem"], "version": p["version"], "runtime": p.get("runtime", False)}
        if doc.motivo:
            actual[k] = {**base, "status": "no_docs", "reason": doc.motivo}
            resumen["no_docs"].append({"package": k, "reason": doc.motivo})
            log(f"    sin documentación: {doc.motivo}")
            _escribir_json(carpeta / INVENTARIO, inventario)
            continue
        tipo, md = preparar(doc)
        cache = carpeta / "docs" / _carpeta_cache(k)
        for fuente, contenido in md.items():
            destino = cache / fuente
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_text(contenido, encoding="utf-8")
        frags = fragmentos_de(p, tipo, md)
        if not frags:
            motivo = "La documentación descargada no tiene páginas de referencia."
            actual[k] = {**base, "status": "no_docs", "reason": motivo}
            resumen["no_docs"].append({"package": k, "reason": motivo})
            _escribir_json(carpeta / INVENTARIO, inventario)
            continue
        log(f"    {len(md)} páginas ({tipo}), {len(frags)} fragmentos: embebiendo…")
        vectores = embebedor.documentos([f["payload"]["text"] for f in frags])
        indice.asegurar(len(vectores[0]))
        indice.subir([{"id": f["id"], "vector": v, "payload": f["payload"]} for f, v in zip(frags, vectores)])
        huella = hashlib.sha256("".join(md[f] for f in sorted(md)).encode("utf-8")).hexdigest()[:16]
        actual[k] = {
            **base,
            "status": "indexed",
            "doc_type": tipo,
            "filters": filtros_de(tipo),
            "fingerprint": huella,
            "chunks": len(frags),
            "truncated": sum(1 for f in frags if len(f["payload"]["text"]) > LIMITE_TRUNCADO),
            "origin": doc.origen,
        }
        resumen[lista].append(k)
        resumen["chunks"] += len(frags)
        inventario["updated"] = datetime.now().astimezone().isoformat(timespec="seconds")
        _escribir_json(carpeta / INVENTARIO, inventario)

    inventario["updated"] = datetime.now().astimezone().isoformat(timespec="seconds")
    _escribir_json(carpeta / INVENTARIO, inventario)
    return resumen


def borrar(raiz: Path, indice=None) -> dict:
    raiz = Path(raiz).resolve()
    coleccion = _leer_json(raiz / RAG / INVENTARIO, {}).get("collection") or nombre_coleccion(raiz)
    indice = indice or IndiceQdrant(coleccion)
    return {"collection": coleccion, "deleted": indice.borrar_coleccion()}


def main() -> None:
    parser = argparse.ArgumentParser(description="Indexa la documentación de las dependencias del proyecto.")
    parser.add_argument("--root", required=True)
    parser.add_argument("--borrar", action="store_true", help="Borra la colección del proyecto en Qdrant.")
    args = parser.parse_args()
    raiz = Path(args.root)
    if args.borrar:
        print(json.dumps(borrar(raiz), ensure_ascii=False))
        return
    resumen = ejecutar(raiz, embebedor=EmbebedorOllama(), token=leer_token(raiz))
    print(json.dumps(resumen, ensure_ascii=False))


if __name__ == "__main__":
    main()
