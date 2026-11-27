# Documentación de las dependencias

Dos canales dan a los agentes la documentación de la versión que usa tu proyecto: Context7 (por defecto) y un RAG local. Cada canal tiene su doc: [Context7](CONTEXT7.md) y [RAG local](RAG-LOCAL.md).

`code-developer` y `code-tester` consultan la documentación oficial antes de usar una API de una dependencia. `/setup-context7` y `/setup-docs-rag` leen las dependencias de `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod` y `Cargo.toml`, en la raíz y en las subcarpetas. En un repositorio git las buscan con `git ls-files` (sin `node_modules` ni `dist`), que respeta `.gitignore` y no limita la profundidad; sin git recorren hasta 3 niveles. Proponen todas salvo los tipos y las utilidades de build, y piden confirmación una sola vez.

## Canales de documentación

| Canal | MCP | Qué sale del ordenador | Requisitos |
|---|---|---|---|
| **Context7** (por defecto) | `context7`, remoto | El nombre de la librería y la pregunta, hacia Upstash | Ninguno |
| **RAG local** | `docs-rag`, local | Solo la descarga de la documentación | Docker, Ollama y `uv` |

Solo hay un canal activo: `/setup-docs-rag` quita Context7 de la config de usuario y su regla del proyecto, y `/setup-context7` quita `docs-rag` de la config del proyecto. `apm install` y `apm update` no tocan esta elección.

> **Nota:** Context7 se registra en la config de usuario, así que pasar un proyecto al RAG local deja sin Context7 a los demás proyectos del ordenador hasta que repitas `/setup-context7`.
