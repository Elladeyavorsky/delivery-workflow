# RAG local

El RAG local es el canal alternativo a Context7. Para comparar los canales y elegir, ver [Canales de documentación](DEPENDENCY-DOCS.md#canales-de-documentación).

`/setup-docs-rag` indexa en tu ordenador la documentación oficial de cada dependencia y de cada runtime fijado (Python, Node, Go y Rust), en la versión exacta del lockfile; sin lockfile usa la mínima del rango y lo avisa. Después registra en el proyecto el MCP `docs-rag`, con las herramientas `resolve_package` y `query_docs`. Sus datos y sus respuestas tienen las claves en inglés.

- **Requisitos:** [Docker](https://www.docker.com) (arranca Qdrant en el contenedor `docs-rag-qdrant`), [Ollama](https://ollama.com) (descarga `nomic-embed-text`) y [uv](https://docs.astral.sh/uv/) (descarga Python 3.15 si no está y prepara el entorno en `.docs-rag/venv`). La primera vez descarga también el reordenador, unos cientos de MB con PyTorch.
- **En el proyecto, fuera de git:** el código del MCP, su entorno y el índice van en `.docs-rag/`, que trae su propio `.gitignore`.
- **Registro:** `docs-rag` va en `opencode.json`, `.mcp.json`, `.cursor/mcp.json` y `.codex/config.toml` del proyecto, con rutas relativas. La skill no modifica un `opencode.jsonc`: si declara `context7` o `docs-rag`, lo avisa.
- **opencode:** el comando del MCP arranca con `bash` y va antes a la raíz del repositorio git, porque opencode lanza el servidor en la carpeta desde la que se abre. En Windows hace falta `bash` (WSL o Git Bash). En opencode 2.x, reinicia opencode para que cargue el MCP.
- **Tras cambiar dependencias:** repite `/setup-docs-rag`. Solo reindexa lo que cambió.
- **Receta:** troceo por la estructura del Markdown, `nomic-embed-text`, Qdrant y reordenado con MiniLM-L6, medida en [research/rag-documentacion-python-3.15.pdf](research/rag-documentacion-python-3.15.pdf). Cada tipo de documentación (Sphinx, MkDocs, Markdown, Node, TypeDoc, Go y Rust) guarda sus propios metadatos para filtrar.

> **Nota:** Al subir a git esos ficheros de config, quien no haya lanzado `/setup-docs-rag` verá un MCP que no arranca.

> **Nota:** Al actualizar desde una versión anterior, `/setup-docs-rag` quita el `docs-rag` de la config de usuario y vuelve a indexar todo, porque el índice anterior tenía los metadatos en español. `~/.docs-rag/` ya no se usa: puedes borrarlo.
