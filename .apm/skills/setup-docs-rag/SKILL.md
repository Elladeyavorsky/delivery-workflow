---
name: setup-docs-rag
description: "Configura el RAG local de documentación como canal de documentación de este ordenador: inventaría las dependencias y runtimes del proyecto con su versión exacta, indexa su documentación oficial en Qdrant y registra el MCP docs-rag en Cursor, Claude Code y Codex (sustituye a Context7). Úsala cuando la persona quiera que las consultas de documentación no salgan de su ordenador, o para reindexar tras cambiar dependencias."
---

### Herramienta: SETUP_DOCS_RAG

- **Descripción**: Úsala para dejar el RAG local como canal de documentación. Hace cuatro cosas:
  - Lee los manifiestos y lockfiles del proyecto y saca cada dependencia y cada runtime fijado con su versión.
  - Descarga la documentación oficial de esa versión y la trocea con los metadatos de su tipo de documentación.
  - La indexa en un Qdrant local con `nomic-embed-text` (Ollama).
  - Registra el MCP `docs-rag` en la config de usuario de cada herramienta.

  La receta está en `docs/research/rag-documentacion-python-3.15.pdf` del repositorio de delivery-workflow. Funciona con Cursor, Claude Code y Codex.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/setup-docs-rag.mjs" ORDEN [OPCIONES]`, desde la raíz del repositorio.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/setup-docs-rag`.

#### Un solo canal por ordenador

- Sin elección guardada, el canal es Context7 (`/setup-context7`). Esta skill lo cambia a `docs-rag`.
- Registrar uno quita el otro de la misma config. Para volver a Context7, lanza `/setup-context7`.
- Todo queda fuera de git:
  - El registro va en la config de usuario: `~/.claude.json`, `~/.cursor/mcp.json` y `~/.codex/config.toml`.
  - El código y su entorno Python van en `~/.docs-rag/`.
  - El índice del proyecto va en `.docs-rag/`, que trae su propio `.gitignore` con `*`.
- `apm install` no lee ni cambia nada de esto.

#### Especificación de Argumentos

1. **Orden** _(Obligatorio)_:
   - `detect`: no escribe nada. Devuelve:
     - `inventario`:
       - `dependencias`, cada una con `version` y `origen`: `lockfile`, `fijado` o `rango` (mínima del rango, con aviso).
       - `runtimes`: Python, Node, Go y Rust fijados en `.python-version`, `requires-python`, `.nvmrc`, `.node-version`, `engines.node`, `go.mod` o `rust-toolchain.toml`.
       - `descartadas` con su motivo.
       - `manifests` y `avisos`.
     - `requisitos`: `docker`, `ollama` y `uv`, cada uno con `ok` y `detalle`.
     - `indice`: si ya hay índice, cuántos paquetes, cuáles quedaron `sin_doc` y por qué.
     - `herramientas`: el canal actual de cada una (`context7`, `docs-rag`, `ninguno` o `los dos`).
   - `apply`: hace todo el proceso:
     1. Comprueba los requisitos. Si falta alguno, para sin tocar nada.
     2. Escribe `.docs-rag/peticion.json`.
     3. Usa el Qdrant que ya responda en `localhost:6333` (`qdrant: "existente"`). Si no hay ninguno, arranca el contenedor `docs-rag-qdrant`. Después descarga `nomic-embed-text` si no está.
     4. Instala el código en `~/.docs-rag/app`.
     5. Indexa solo lo que cambió: lo nuevo, las versiones distintas y lo que ya no está.
     6. Registra `docs-rag` en cada herramienta y quita `context7`.

     Repetirlo sin cambios no descarga ni embebe nada.
   - `reset`: quita el MCP `docs-rag` de la config de usuario. Con `--drop-index` borra también la colección de Qdrant y la carpeta `.docs-rag/`.
2. **`--libs a,b,c`** _(Opcional)_: solo esas dependencias. Sin la opción, todas las del inventario con versión. Lo que ya estaba indexado y no se pide se borra del índice.
3. **`--sin-runtimes`** _(Opcional)_: no indexa la documentación de los runtimes.
4. **`--target cursor|claude|codex`** _(Opcional)_: una sola herramienta. Por defecto, todas las que tengan carpeta de agentes.
5. **`--drop-index`** _(Opcional, solo con `reset`)_.

#### Reglas de Invocación Críticas

- **Tú hablas, el script no**: El script nunca pregunta. Las preguntas las haces tú y le pasas las respuestas con `--libs` y `--sin-runtimes`.
- **Flujo**:
  1. Lanza `detect`.
     - Si falla porque no hay carpeta de agentes, dile a la persona que ejecute `apm install`.
     - Si algún `requisitos.*.ok` es `false`, enseña su `detalle` y para hasta que lo instale.
  2. Muestra el inventario:
     - Una tabla con paquete, ecosistema, versión y origen: primero los runtimes, después las dependencias.
     - Debajo, en una línea, las `descartadas` con su motivo y los `avisos`.
     - Si ya hay índice, di cuántos paquetes tiene, cuáles están `sin_doc` y el canal actual de cada herramienta.
  3. Pregunta **una vez**: «¿Indexo esto? [Enter = sí | nombre de un paquete para quitarlo | "sin runtimes"]». Repite hasta que acepte.
  4. Avisa de lo que tarda la primera vez: descarga Qdrant, el modelo de embeddings, el reordenador y la documentación, y luego embebe. Después, lanza `apply` con `--libs` solo si la persona quitó algo. El progreso sale por stderr.
  5. Muestra el resultado:
     - Una tabla con herramienta, archivo de configuración y `result`.
     - El resumen del `indice`: indexados, reindexados, borrados, iguales, `sin_doc` con su motivo, y fragmentos.
     - Las `notes` y los `avisos`.
  6. Recuerda recargar el editor, o la sesión de Claude Code o Codex, para que cargue el MCP.
- **Qué sale del ordenador**: solo la descarga de la documentación, desde PyPI, Read the Docs, npm, GitHub, docs.rs, crates.io, proxy.golang.org, go.dev, nodejs.org o docs.python.org. Las preguntas de los agentes y los fragmentos se quedan en local.
- **`GITHUB_TOKEN`**: si está en el `.env` del proyecto o en la terminal, se usa solo para subir el límite de la API de GitHub. Nunca se escribe en ningún archivo.
- **Cuándo repetirla**: tras cambiar dependencias o el lockfile, vuelve a lanzar `/setup-docs-rag`; solo se reindexa lo que cambió. Con `apm install` o `apm update` no hace falta.
- **Procesamiento de respuestas**: El script escribe JSON por stdout.
  - `result` vale `cambiado`, `igual` o `ausente`.
  - Si el código de salida no es 0, lee el error y comunícalo. Un archivo de configuración con JSON o TOML inválido no se modifica.
  - Usa solo los paquetes, versiones y resultados que devuelve el script.

#### El MCP `docs-rag`

Tiene dos herramientas, con el mismo flujo que Context7:

- `resolver_paquete(nombre)`: los paquetes indexados que coinciden, con su versión, tipo de documentación y los `filtros` que admite. Si un paquete no tiene documentación, devuelve `sin_doc` con el motivo.
- `consultar_docs(paquete, pregunta, filtros?, k=4)`:
  - Busca 20 candidatos del paquete y los reordena con MiniLM-L6.
  - Devuelve los `k` mejores, cada uno con `fuente`, `texto`, `score_reranking` y sus metadatos.
  - Si los `filtros` no dejan ningún candidato con puntuación ≥ 0, repite sin ellos y devuelve `filtrado: false`.

Sin índice, el servidor arranca igual y sus herramientas responden un error que pide lanzar `/setup-docs-rag`.
