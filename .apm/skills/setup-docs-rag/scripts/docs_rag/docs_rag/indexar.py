"""Indexador: lleva la colección del proyecto al inventario pedido en .docs-rag/peticion.json.

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
                "paquete": p["paquete"],
                "version": p["version"],
                "ecosistema": p["ecosistema"],
                "tipo_doc": tipo,
                "fuente": fuente,
                "ruta_titulos": f["ruta_titulos"],
                "texto": f["texto"],
                **metadatos_fragmento(tipo, f["texto"], fichero),
            }
            salida.append({"id": id_fragmento(p["ecosistema"], p["paquete"], p["version"], fuente, f["n"]), "payload": payload})
    return salida


def ejecutar(raiz: Path, *, http=fuentes.http_real, indice=None, embebedor=None, token: str | None = None) -> dict:
    raiz = Path(raiz).resolve()
    carpeta = raiz / RAG
    carpeta.mkdir(exist_ok=True)
    peticion = _leer_json(carpeta / "peticion.json", None)
    if peticion is None:
        raise SystemExit(f"No hay {RAG}/peticion.json: lanza antes setup-docs-rag apply.")
    coleccion = nombre_coleccion(raiz)
    inventario = _leer_json(carpeta / "inventario.json", {"coleccion": coleccion, "paquetes": {}})
    inventario["coleccion"] = coleccion
    actual = inventario.setdefault("paquetes", {})
    indice = indice or IndiceQdrant(coleccion)
    plan = plan_reindexado(peticion["paquetes"], actual)
    pedidas = {clave(p): p for p in peticion["paquetes"]}
    resumen = {"coleccion": coleccion, "indexados": [], "reindexados": [], "borrados": [], "iguales": plan["igual"], "sin_doc": [], "avisos": [], "fragmentos": 0}

    for k in plan["borrar"]:
        a = actual.pop(k)
        indice.borrar_paquete(a["ecosistema"], a["paquete"])
        resumen["borrados"].append(k)
        log(f"borrado {k}")
    _escribir_json(carpeta / "inventario.json", inventario)

    trabajo = [(k, "indexados") for k in plan["indexar"]] + [(k, "reindexados") for k in plan["reindexar"]]
    for n, (k, lista) in enumerate(trabajo, 1):
        p = pedidas[k]
        log(f"[{n}/{len(trabajo)}] {k} {p['version']}: descargando documentación…")
        doc = fuentes.documentar(p["paquete"], p["ecosistema"], p["version"], http=http, token=token)
        resumen["avisos"] += doc.avisos
        if k in actual:
            indice.borrar_paquete(p["ecosistema"], p["paquete"])
        base = {"paquete": p["paquete"], "ecosistema": p["ecosistema"], "version": p["version"], "runtime": p.get("runtime", False)}
        if doc.motivo:
            actual[k] = {**base, "estado": "sin_doc", "motivo": doc.motivo}
            resumen["sin_doc"].append({"paquete": k, "motivo": doc.motivo})
            log(f"    sin documentación: {doc.motivo}")
            _escribir_json(carpeta / "inventario.json", inventario)
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
            actual[k] = {**base, "estado": "sin_doc", "motivo": motivo}
            resumen["sin_doc"].append({"paquete": k, "motivo": motivo})
            _escribir_json(carpeta / "inventario.json", inventario)
            continue
        log(f"    {len(md)} páginas ({tipo}), {len(frags)} fragmentos: embebiendo…")
        vectores = embebedor.documentos([f["payload"]["texto"] for f in frags])
        indice.asegurar(len(vectores[0]))
        indice.subir([{"id": f["id"], "vector": v, "payload": f["payload"]} for f, v in zip(frags, vectores)])
        huella = hashlib.sha256("".join(md[f] for f in sorted(md)).encode("utf-8")).hexdigest()[:16]
        actual[k] = {
            **base,
            "estado": "indexado",
            "tipo_doc": tipo,
            "filtros": filtros_de(tipo),
            "huella": huella,
            "fragmentos": len(frags),
            "truncados": sum(1 for f in frags if len(f["payload"]["texto"]) > LIMITE_TRUNCADO),
            "origen": doc.origen,
        }
        resumen[lista].append(k)
        resumen["fragmentos"] += len(frags)
        inventario["actualizado"] = datetime.now().astimezone().isoformat(timespec="seconds")
        _escribir_json(carpeta / "inventario.json", inventario)

    inventario["actualizado"] = datetime.now().astimezone().isoformat(timespec="seconds")
    _escribir_json(carpeta / "inventario.json", inventario)
    return resumen


def borrar(raiz: Path, indice=None) -> dict:
    raiz = Path(raiz).resolve()
    coleccion = _leer_json(raiz / RAG / "inventario.json", {}).get("coleccion") or nombre_coleccion(raiz)
    indice = indice or IndiceQdrant(coleccion)
    return {"coleccion": coleccion, "borrada": indice.borrar_coleccion()}


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
