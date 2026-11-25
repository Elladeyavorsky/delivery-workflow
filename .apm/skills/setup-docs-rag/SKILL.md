---
name: setup-docs-rag
description: "Configura el RAG local de documentación en este proyecto: inventaría las dependencias y runtimes con su versión exacta, indexa su documentación oficial en Qdrant e instala y registra el MCP docs-rag en la config del proyecto de opencode, Claude Code, Cursor y Codex. Úsala cuando la persona quiera que las consultas de documentación no salgan de su ordenador, o para reindexar tras cambiar dependencias."
---

### Herramienta: SETUP_DOCS_RAG

- **Descripción**: Úsala para dejar el RAG local como canal de documentación del proyecto. Hace cuatro cosas:
  - Lee los manifiestos y lockfiles del proyecto y saca cada dependencia y cada runtime fijado con su versión.
  - Descarga la documentación oficial de esa versión y la trocea con los metadatos de su tipo de documentación.
  - La indexa en un Qdrant local con `nomic-embed-text` (Ollama).
  - Instala el MCP `docs-rag` en `.docs-rag/` y lo registra en la config del proyecto de cada herramienta.

  La receta está en `docs/research/rag-documentacion-python-3.15.pdf` del repositorio de delivery-workflow. Funciona con opencode, Cursor, Claude Code y Codex.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/setup-docs-rag.mjs" ORDEN [OPCIONES]`, desde la raíz del repositorio.

La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/setup-docs-rag`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

#### Todo vive en el proyecto

- El código del MCP, su entorno Python y el índice van en `.docs-rag/` (`app/`, `venv/`, `inventory.json`, `request.json` y `docs/`). La carpeta trae su propio `.gitignore` con `*`.
- El registro va en la config del proyecto: `opencode.json` (opencode), `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor) y `.codex/config.toml` (Codex). La entrada usa rutas relativas al proyecto, sin rutas de este ordenador. La de opencode arranca con `bash` y va antes a la raíz del repositorio git, porque opencode lanza el servidor en la carpeta desde la que se abre. La skill no toca el `.gitignore` del proyecto: cada proyecto decide si sube esos ficheros.
- Solo hay un canal de documentación. `apply` quita `context7` de la config de usuario y la regla «Context7» de `AGENTS.md` o `CLAUDE.md`. Esa config es de usuario: la herramienta deja de usar Context7 también en los demás proyectos del ordenador. Para volver, `/setup-context7`, que quita `docs-rag` del proyecto.
- `apply` quita el `docs-rag` que versiones anteriores dejaban en `~/.claude.json`, `~/.cursor/mcp.json` y `~/.codex/config.toml`. `~/.docs-rag/` ya no se usa y no se borra solo.
- Un `opencode.jsonc` que declare `context7` o `docs-rag` no se modifica: `apply` lo avisa en las `notes`.
- `apm install` no lee ni cambia nada de esto.

#### Especificación de Argumentos

1. **Orden** _(Obligatorio)_:
   - `detect`: no escribe nada. Devuelve:
     - `inventory`:
       - `dependencies`, cada una con `package`, `ecosystem`, `version`, `origin` y `source`. `origin` vale `lockfile`, `pinned` o `range` (mínima del rango, con aviso).
       - `runtimes`: Python, Node, Go y Rust fijados en `.python-version`, `requires-python`, `.nvmrc`, `.node-version`, `engines.node`, `go.mod` o `rust-toolchain.toml`.
       - `discarded`, cada una con su `reason`.
       - `manifests` y `warnings`.
     - `requirements`: `docker`, `ollama`, `uv`, `model` y `qdrant`, cada uno con `ok` y `detail`.
     - `index`: si ya hay índice (`exists`), cuántos paquetes están `indexed`, cuáles quedaron en `no_docs` y por qué, y los `chunks`. `legacy: true` si solo hay un índice del formato anterior.
     - `tools`: el fichero de config del proyecto y el canal actual de cada herramienta (`context7`, `docs-rag`, `none` o, si alguien editó la config a mano, `both`; `apply` lo deja en `docs-rag`).
   - `apply`: hace todo el proceso:
     1. Comprueba los requisitos. Si falta alguno, para sin tocar nada.
     2. Escribe `.docs-rag/request.json`.
     3. Usa el Qdrant que ya responda en `localhost:6333` (`qdrant: "existing"`). Si no hay ninguno, arranca el contenedor `docs-rag-qdrant`. Después descarga `nomic-embed-text` si no está (`model`: `unchanged` o `downloaded`).
     4. Instala el código en `.docs-rag/app` y su entorno en `.docs-rag/venv`.
     5. Indexa solo lo que cambió: lo nuevo, las versiones distintas y lo que ya no está. Un índice del formato anterior (`.docs-rag/inventario.json`) se borra y se indexa todo de nuevo.
     6. Registra `docs-rag` en la config del proyecto de cada herramienta, quita Context7 (su MCP de la config de usuario y su regla del proyecto, en `context7Removed`) y quita el `docs-rag` de usuario de versiones anteriores.

     Repetirlo sin cambios no descarga ni embebe nada.
   - `reset`: quita el MCP `docs-rag` de la config del proyecto (y de la de usuario, si queda de una versión anterior). Con `--drop-index` borra también la colección de Qdrant y la carpeta `.docs-rag/` entera.
2. **`--libs a,b,c`** _(Opcional)_: solo esas dependencias. Sin la opción, todas las del inventario con versión. Lo que ya estaba indexado y no se pide se borra del índice.
3. **`--no-runtimes`** _(Opcional)_: no indexa la documentación de los runtimes.
4. **`--target opencode|cursor|claude|codex`** _(Opcional)_: una sola herramienta. Por defecto, todas las que tengan carpeta de agentes.
5. **`--drop-index`** _(Opcional, solo con `reset`)_.

#### Reglas de Invocación Críticas

- **Tú hablas, el script no**: El script nunca pregunta. Las preguntas las haces tú y le pasas las respuestas con `--libs` y `--no-runtimes`.
- **Flujo**:
  1. Lanza `detect`.
     - Si falla porque no hay carpeta de agentes, dile a la persona que ejecute `apm install`.
     - Si alguno de `requirements.docker`, `requirements.ollama` o `requirements.uv` tiene `ok` en `false`, enseña su `detail` y para hasta que lo instale.
  2. Muestra el inventario:
     - Una tabla con paquete, ecosistema, versión y origen: primero los runtimes, después las dependencias.
     - Debajo, en una línea, las `discarded` con su `reason` y los `warnings`.
     - Si ya hay índice, di cuántos paquetes tiene, cuáles están en `no_docs` y el canal actual de cada herramienta. Si `index.legacy` es `true`, avisa de que se indexará todo de nuevo.
     - Si el `channel` de alguna herramienta es `context7` o `both`, avisa de que Context7 dejará de usarse en esa herramienta, también en los demás proyectos del ordenador, hasta lanzar `/setup-context7`.
  3. Pregunta **una vez**: «¿Indexo esto? [Enter = sí | nombre de un paquete para quitarlo | "sin runtimes"]». Repite hasta que acepte.
  4. Avisa de lo que tarda la primera vez: descarga Qdrant, el modelo de embeddings, el reordenador y la documentación, y luego embebe. Después, lanza `apply` con `--libs` solo si la persona quitó algo. El progreso sale por stderr.
  5. Muestra el resultado:
     - Una tabla con herramienta, archivo de configuración y `result`.
     - El resumen del `index`: `indexed`, `reindexed`, `deleted`, `unchanged`, `no_docs` con su `reason`, y `chunks`.
     - Las `notes` y los `warnings`.
  6. Recuerda recargar el editor, o la sesión de opencode, Claude Code o Codex, para que cargue el MCP.
- **Qué sale del ordenador**: solo la descarga de la documentación, desde PyPI, Read the Docs, npm, GitHub, gitlab.com, codeberg.org, api.bitbucket.org, el host del remoto git de un paquete autogestionado (GitLab o Gitea/Forgejo), docs.rs, crates.io, proxy.golang.org, go.dev, nodejs.org o docs.python.org. Las preguntas de los agentes y los fragmentos se quedan en local.
- **`GITHUB_TOKEN`**: si está en el `.env` del proyecto o en la terminal, se usa solo para subir el límite de la API de GitHub (`api.github.com` y `raw.githubusercontent.com`); GitLab, Gitea, Forgejo y Bitbucket no lo reciben. Nunca se escribe en ningún archivo.
- **Cuándo repetirla**: tras cambiar dependencias o el lockfile, vuelve a lanzar `/setup-docs-rag`; solo se reindexa lo que cambió. Con `apm install` o `apm update` no hace falta.
- **Procesamiento de respuestas**: El script escribe JSON por stdout, con las claves en inglés. Los textos para la persona (`notes`, `warnings`, `detail`, `reason`) van en español.
  - `result` vale `changed`, `unchanged` o `missing`.
  - Si el código de salida no es 0, lee el error y comunícalo. Un archivo de configuración con JSON o TOML inválido no se modifica.
  - Usa solo los paquetes, versiones y resultados que devuelve el script.

#### El MCP `docs-rag`

Tiene dos herramientas, con el mismo flujo que Context7:

- `resolve_package(name)`: los paquetes indexados que coinciden (`packages`), cada uno con `package` (`ecosystem:package`), `version`, `status`, `doc_type` y los `filters` que admite. Si un paquete no tiene documentación, devuelve `no_docs` con el motivo.
- `query_docs(package, question, filters?, k=4)`:
  - Busca 20 candidatos del paquete y los reordena con MiniLM-L6.
  - Devuelve en `results` los `k` mejores, cada uno con `source`, `text`, `heading_path`, `rerank_score` y sus metadatos (`has_code`, `deprecated`, `symbols`…).
  - Si los `filters` no dejan ningún candidato con puntuación ≥ 0, repite sin ellos y devuelve `filtered: false`.

Sin índice, el servidor arranca igual y sus herramientas responden un error que pide lanzar `/setup-docs-rag`.
