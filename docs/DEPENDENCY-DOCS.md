# Documentación de las dependencias

Dos canales dan a los agentes la documentación de la versión que usa tu proyecto: Context7 (por defecto) y un RAG local. Este documento explica los dos y cómo elegir.

`code-developer` y `code-tester` consultan la documentación oficial de la versión que usa tu proyecto antes de usar una API de una dependencia. Las dos skills leen las dependencias de `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod` y `Cargo.toml`, en la raíz y en las subcarpetas. En un repositorio git las busca con `git ls-files` (sin `node_modules` ni `dist`), que respeta `.gitignore` y no limita la profundidad; sin git recorre hasta 3 niveles. Proponen todas salvo los tipos y las utilidades de build, y piden confirmación una sola vez.

| Canal | MCP | Qué sale del ordenador | Requisitos |
|---|---|---|---|
| **Context7** (por defecto) | `context7`, remoto | El nombre de la librería y la pregunta, hacia Upstash | Ninguno |
| **RAG local** | `docs-rag`, local | Solo la descarga de la documentación | Docker, Ollama y `uv` |

Solo hay un canal activo: `/setup-docs-rag` quita Context7 de la config de usuario y su regla del proyecto, y `/setup-context7` quita `docs-rag` de la config del proyecto. `apm install` y `apm update` no tocan esta elección.

> **Nota:** Context7 se registra en la config de usuario, así que pasar un proyecto al RAG local deja sin Context7 a los demás proyectos del ordenador hasta que repitas `/setup-context7`.

## Context7

[Context7](https://context7.com) da a los agentes la documentación actual y de la versión concreta de cada librería, para que no escriban código para versiones antiguas. `/setup-context7` escribe el MCP `context7` en `~/.claude.json` (Claude Code), `~/.cursor/mcp.json` (Cursor) y `~/.codex/config.toml` (Codex), sin tocar otros MCP, y deja una regla con tus librerías en `AGENTS.md` o `CLAUDE.md`.

La clave es opcional: sin ella, el límite de peticiones es menor. Para usarla, crea una clave gratis en context7.com/dashboard y añádela al `.env`, junto al token de GitHub:

```dotenv
CONTEXT7_API_KEY=tu-clave
```

Los editores no leen el `.env` solos. Antes de abrir el editor, cárgalo en la terminal y ábrelo desde ahí:

```bash
set -a; source .env; set +a
cursor .      # o claude, o codex
```

## RAG local

`/setup-docs-rag` indexa en tu ordenador la documentación oficial de cada dependencia y de cada runtime fijado (Python, Node, Go y Rust), en la versión exacta del lockfile; sin lockfile usa la mínima del rango y lo avisa. Después registra en el proyecto el MCP `docs-rag`, con las herramientas `resolve_package` y `query_docs`. Sus datos y sus respuestas tienen las claves en inglés.

- **Requisitos:** [Docker](https://www.docker.com) (arranca Qdrant en el contenedor `docs-rag-qdrant`), [Ollama](https://ollama.com) (descarga `nomic-embed-text`) y [uv](https://docs.astral.sh/uv/) (descarga Python 3.15 si no está y prepara el entorno en `.docs-rag/venv`). La primera vez descarga también el reordenador, unos cientos de MB con PyTorch.
- **En el proyecto, fuera de git:** el código del MCP, su entorno y el índice van en `.docs-rag/`, que trae su propio `.gitignore`.
- **Registro:** `docs-rag` va en `.mcp.json`, `.cursor/mcp.json` y `.codex/config.toml` del proyecto, con rutas relativas.
- **Tras cambiar dependencias:** repite `/setup-docs-rag`. Solo reindexa lo que cambió.
- **Receta:** troceo por la estructura del Markdown, `nomic-embed-text`, Qdrant y reordenado con MiniLM-L6, medida en [research/rag-documentacion-python-3.15.pdf](research/rag-documentacion-python-3.15.pdf). Cada tipo de documentación (Sphinx, MkDocs, Markdown, Node, TypeDoc, Go y Rust) guarda sus propios metadatos para filtrar.

> **Nota:** Quien no haya lanzado `/setup-docs-rag` verá un MCP que no arranca si subes los ficheros de config a git.

> **Nota:** Desde una versión anterior, `/setup-docs-rag` quita el `docs-rag` de la config de usuario y vuelve a indexar todo, porque el índice anterior tenía los metadatos en español. `~/.docs-rag/` ya no se usa: puedes borrarlo.
