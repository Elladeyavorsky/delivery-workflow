"""Servidor MCP docs-rag: resolve_package y query_docs sobre el índice local del proyecto.

Arranca siempre, aunque no haya índice, y sin cargar modelos: Ollama, Qdrant y el reordenador
se cargan en la primera consulta. Ninguna herramienta indexa.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .consulta import Consultor

mcp = FastMCP("docs-rag")
_consultor: Consultor | None = None


def _raiz_inicial(argumento: str | None) -> Path:
    # Cursor pasa --root ${workspaceFolder}; si la variable no se sustituye, se usa el directorio de trabajo.
    if argumento and "${" not in argumento:
        return Path(argumento)
    return Path(os.environ.get("DOCS_RAG_ROOT") or os.getcwd())


@mcp.tool()
def resolve_package(name: str) -> dict:
    """Finds a package or runtime in this project's documentation index.

    Returns each match with its id (ecosystem:package), the indexed version, the documentation type
    and the filters that query_docs accepts. If it has no documentation, says why.
    Call it before query_docs.
    """
    return _consultor.resolver_paquete(name)


@mcp.tool()
def query_docs(package: str, question: str, filters: dict | None = None, k: int = 4) -> dict:
    """Chunks of the official documentation of that package, in the version the project uses.

    package: the id that resolve_package returns (ecosystem:package). question: in English, one per
    API decision and with the exact API name. filters: optional, only the ones resolve_package
    returned (for example {"symbols": "asyncio.timeout"} or {"deprecated": false}).
    Check that the first chunk names the API you asked about; if not, ask again with the exact name.
    """
    return _consultor.consultar_docs(package, question, filters, k)


def _separar_stdin() -> None:
    """En Windows, mientras el transporte MCP tiene una lectura pendiente en la tubería de stdin, cargar
    una DLL (numpy, torch) en otro hilo se bloquea hasta que llega el siguiente mensaje. El transporte
    lee de una copia de stdin y el descriptor 0 pasa a NUL, así la carga diferida de los modelos no se cuelga."""
    if sys.platform != "win32":
        return
    copia = os.dup(0)
    nul = os.open(os.devnull, os.O_RDONLY)
    os.dup2(nul, 0)
    os.close(nul)
    sys.stdin = io.TextIOWrapper(io.BufferedReader(io.FileIO(copia, "rb")), encoding="utf-8")


def main() -> None:
    global _consultor
    parser = argparse.ArgumentParser(description="Servidor MCP de documentación local (docs-rag).")
    parser.add_argument("--root", help="Carpeta del proyecto. Por defecto, el directorio de trabajo.")
    args = parser.parse_args()
    _consultor = Consultor(_raiz_inicial(args.root))
    _separar_stdin()
    mcp.run()


if __name__ == "__main__":
    main()
