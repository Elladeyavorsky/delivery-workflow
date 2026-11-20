"""Indexador: lleva la colección del proyecto al inventario pedido en .docs-rag/request.json.

Solo toca lo que cambió (reindex_plan). El progreso va a stderr y el resumen JSON a stdout.
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

from . import sources
from .store import TRUNCATE_LIMIT, OllamaEmbedder, QdrantStore, package_key, chunk_id, collection_name, reindex_plan
from .cleanup import to_markdown, is_reference, remove_repeated
from .profiles import detect_doc_type, filters_for, file_metadata, chunk_metadata
from .chunking import chunk_file

RAG_DIR = ".docs-rag"
INVENTORY = "inventory.json"
REQUEST = "request.json"
# Ficheros del formato anterior, con las claves en español: se borran al migrar.
LEGACY_INVENTORY = "inventario.json"
LEGACY_REQUEST = "peticion.json"


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def read_token(root: Path) -> str | None:
    """GITHUB_TOKEN del .env del proyecto (sin ejecutarlo) o del entorno. Solo sube el límite de la API de GitHub."""
    env = root / ".env"
    if env.is_file():
        for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"^\s*(?:export\s+)?GITHUB_TOKEN\s*=\s*(.*)$", line)
            if m:
                field_value = m.group(1).strip()
                q = re.match(r"^([\"'])(.*?)\1", field_value)
                field_value = q.group(2) if q else re.sub(r"\s+#.*$", "", field_value)
                if field_value:
                    return field_value
    return os.environ.get("GITHUB_TOKEN") or None


def _read_json(file_path: Path, default):
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write_json(file_path: Path, data) -> None:
    tmp = file_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(file_path)


def _cache_dir(k: str) -> str:
    return re.sub(r"[^\w.@-]+", "_", k)


def prepare(doc: sources.Documentation) -> tuple[str, dict[str, str]]:
    """Markdown limpio de cada fichero y tipo de documentación del paquete."""
    md: dict[str, str] = {}
    for source, text in doc.files.items():
        fresh, content = to_markdown(source, text)
        if is_reference(fresh) and content.strip():
            md[fresh] = content
    md = remove_repeated(md)
    return detect_doc_type(md, doc.hint), md


def chunks_for(p: dict, doc_type: str, md: dict[str, str]) -> list[dict]:
    """Fragmentos con el núcleo común y los campos del perfil, listos para embeber."""
    output = []
    for source, content in sorted(md.items()):
        doc_file = file_metadata(doc_type, source, content)
        for f in chunk_file(source, content):
            payload = {
                "package": p["package"],
                "version": p["version"],
                "ecosystem": p["ecosystem"],
                "doc_type": doc_type,
                "source": source,
                "heading_path": f["heading_path"],
                "text": f["text"],
                **chunk_metadata(doc_type, f["text"], doc_file),
            }
            output.append({"id": chunk_id(p["ecosystem"], p["package"], p["version"], source, f["n"]), "payload": payload})
    return output


def migrate_legacy_format(folder: Path, collection: str, open_store=QdrantStore) -> str | None:
    """Borra la colección y los ficheros de un índice con el formato anterior. Devuelve la colección borrada."""
    previous = folder / LEGACY_INVENTORY
    if not previous.is_file():
        return None
    old = _read_json(previous, {}).get("coleccion")
    if old and old != collection:
        open_store(old).drop_collection()
    previous.unlink()
    (folder / LEGACY_REQUEST).unlink(missing_ok=True)
    return old


def index_project(root: Path, *, http=sources.http_real, store=None, embedder=None, token: str | None = None, open_store=QdrantStore) -> dict:
    root = Path(root).resolve()
    folder = root / RAG_DIR
    folder.mkdir(exist_ok=True)
    request_data = _read_json(folder / REQUEST, None)
    if request_data is None:
        raise SystemExit(f"No hay {RAG_DIR}/{REQUEST}: lanza antes setup-docs-rag apply.")
    collection = collection_name(root)
    old = migrate_legacy_format(folder, collection, open_store)
    if old is not None:
        log(f"índice del formato anterior borrado ({old}): se indexa de nuevo en {collection}")
    inventory = _read_json(folder / INVENTORY, {"collection": collection, "packages": {}})
    inventory["collection"] = collection
    current = inventory.setdefault("packages", {})
    store = store or QdrantStore(collection)
    plan = reindex_plan(request_data["packages"], current)
    requested_keys = {package_key(p): p for p in request_data["packages"]}
    summary = {"collection": collection, "indexed": [], "reindexed": [], "deleted": [], "unchanged": plan["unchanged"], "no_docs": [], "warnings": [], "chunks": 0}
    if old is not None:
        summary["warnings"].append(f"El índice anterior ({old}) tenía los metadatos en español: se ha borrado y se indexa todo de nuevo.")

    for k in plan["delete"]:
        a = current.pop(k)
        store.delete_package(a["ecosystem"], a["package"])
        summary["deleted"].append(k)
        log(f"borrado {k}")
    _write_json(folder / INVENTORY, inventory)

    work = [(k, "indexed") for k in plan["index"]] + [(k, "reindexed") for k in plan["reindex"]]
    for n, (k, listing) in enumerate(work, 1):
        p = requested_keys[k]
        log(f"[{n}/{len(work)}] {k} {p['version']}: descargando documentación…")
        doc = sources.fetch_docs(p["package"], p["ecosystem"], p["version"], http=http, token=token)
        summary["warnings"] += doc.warnings
        if k in current:
            store.delete_package(p["ecosystem"], p["package"])
        base = {"package": p["package"], "ecosystem": p["ecosystem"], "version": p["version"], "runtime": p.get("runtime", False)}
        if doc.reason:
            current[k] = {**base, "status": "no_docs", "reason": doc.reason}
            summary["no_docs"].append({"package": k, "reason": doc.reason})
            log(f"    sin documentación: {doc.reason}")
            _write_json(folder / INVENTORY, inventory)
            continue
        doc_type, md = prepare(doc)
        cache = folder / "docs" / _cache_dir(k)
        for source, content in md.items():
            target = cache / source
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        file_chunks = chunks_for(p, doc_type, md)
        if not file_chunks:
            reason = "La documentación descargada no tiene páginas de referencia."
            current[k] = {**base, "status": "no_docs", "reason": reason}
            summary["no_docs"].append({"package": k, "reason": reason})
            _write_json(folder / INVENTORY, inventory)
            continue
        log(f"    {len(md)} páginas ({doc_type}), {len(file_chunks)} fragmentos: embebiendo…")
        vectors = embedder.documents([f["payload"]["text"] for f in file_chunks])
        store.ensure(len(vectors[0]))
        store.upload([{"id": f["id"], "vector": v, "payload": f["payload"]} for f, v in zip(file_chunks, vectors)])
        fingerprint = hashlib.sha256("".join(md[f] for f in sorted(md)).encode("utf-8")).hexdigest()[:16]
        current[k] = {
            **base,
            "status": "indexed",
            "doc_type": doc_type,
            "filters": filters_for(doc_type),
            "fingerprint": fingerprint,
            "chunks": len(file_chunks),
            "truncated": sum(1 for f in file_chunks if len(f["payload"]["text"]) > TRUNCATE_LIMIT),
            "origin": doc.origin,
        }
        summary[listing].append(k)
        summary["chunks"] += len(file_chunks)
        inventory["updated"] = datetime.now().astimezone().isoformat(timespec="seconds")
        _write_json(folder / INVENTORY, inventory)

    inventory["updated"] = datetime.now().astimezone().isoformat(timespec="seconds")
    _write_json(folder / INVENTORY, inventory)
    return summary


def drop(root: Path, store=None) -> dict:
    root = Path(root).resolve()
    collection = _read_json(root / RAG_DIR / INVENTORY, {}).get("collection") or collection_name(root)
    store = store or QdrantStore(collection)
    return {"collection": collection, "deleted": store.drop_collection()}


def main() -> None:
    parser = argparse.ArgumentParser(description="Indexa la documentación de las dependencias del proyecto.")
    parser.add_argument("--root", required=True)
    parser.add_argument("--drop", action="store_true", help="Borra la colección del proyecto en Qdrant.")
    args = parser.parse_args()
    root = Path(args.root)
    if args.drop:
        print(json.dumps(drop(root), ensure_ascii=False))
        return
    summary = index_project(root, embedder=OllamaEmbedder(), token=read_token(root))
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
