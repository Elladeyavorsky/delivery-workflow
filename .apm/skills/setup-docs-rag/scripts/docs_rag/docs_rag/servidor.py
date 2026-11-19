"""Servidor MCP docs-rag: resolver_paquete y consultar_docs sobre el índice local del proyecto.

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
def resolver_paquete(nombre: str) -> dict:
    """Busca un paquete o runtime en el índice de documentación de este proyecto.

    Devuelve cada coincidencia con su id (ecosistema:paquete), la versión indexada, el tipo de
    documentación y los filtros que admite consultar_docs. Si no tiene documentación, dice por qué.
    Llámala antes de consultar_docs.
    """
    return _consultor.resolver_paquete(nombre)


@mcp.tool()
def consultar_docs(paquete: str, pregunta: str, filtros: dict | None = None, k: int = 4) -> dict:
    """Fragmentos de la documentación oficial de ese paquete, en la versión que usa el proyecto.

    paquete: el id que devuelve resolver_paquete (ecosistema:paquete). pregunta: en inglés, una por
    decisión de API y con el nombre exacto de la API. filtros: opcionales, solo los que devolvió
    resolver_paquete (por ejemplo {"simbolos": "asyncio.timeout"} o {"deprecated": false}).
    Comprueba que el primer fragmento nombra la API buscada; si no, repite con el nombre exacto.
    """
    return _consultor.consultar_docs(paquete, pregunta, filtros, k)


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
