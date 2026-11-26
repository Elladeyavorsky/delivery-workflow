---
name: setup-context7
description: "Configura Context7 (documentación actual de librerías), el canal de documentación por defecto, en opencode, Claude Code, Cursor y Codex: mira las dependencias del proyecto, sugiere para cuáles usarlo y deja el MCP y la regla del proyecto listos. Úsala tras apm install, cuando la persona quiera que los agentes lean la documentación real de sus librerías, o para volver a Context7 desde el RAG local."
---

### Herramienta: SETUP_CONTEXT7

- **Descripción**: Úsala para configurar Context7 con la persona: leer las dependencias del proyecto, sugerir para cuáles consultarlo, escribir el MCP en cada herramienta y dejar una regla en el proyecto. Sin esta configuración los agentes funcionan igual, pero sin la documentación al día de las librerías. Funciona con opencode, Cursor, Claude Code y Codex.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/setup-context7.mjs" ORDEN [OPCIONES]`, desde la raíz del repositorio.

La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/setup-context7`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

#### Canales de documentación

- Context7 es el canal de documentación por defecto. La alternativa es el RAG local (`/setup-docs-rag`), con su propio MCP `docs-rag`.
- El MCP de Context7 se registra en la config de usuario, fuera de git: `~/.config/opencode/opencode.json` (opencode; con `XDG_CONFIG_HOME`, dentro de esa carpeta), `~/.claude.json` (Claude Code), `~/.cursor/mcp.json` (Cursor) y `~/.codex/config.toml` (Codex).
- opencode lee también `opencode.jsonc`. El script no lo modifica: si declara `context7` o `docs-rag`, lo avisa en las `notes`.
- `docs-rag` se registra en la config de cada proyecto. Solo hay un canal: registrar Context7 quita `docs-rag` de la config del proyecto (`projectConfig`) y el que versiones anteriores dejaban en la de usuario. El índice de `.docs-rag/` no se borra.
- Si el proyecto aún tiene `context7` en `opencode.json`, `.mcp.json`, `.cursor/mcp.json` o `.codex/config.toml` de una versión anterior, `detect` lo marca en `legacyProjectConfig` y `apply` lo avisa en las `notes`. El script no lo borra.

#### Especificación de Argumentos

1. **Orden** _(Obligatorio)_:
   - `detect`: no escribe nada. Devuelve:
     - Las dependencias del proyecto: `sugerida`, o `descartada` con su motivo. Cada una trae `sources` con los archivos de donde sale.
     - Los manifiestos leídos, en la raíz y en cualquier subcarpeta (con `git ls-files`, sin lo que `.gitignore` ignora; sin git, hasta 3 niveles). Un manifiesto ilegible trae `error` y no para el resto.
     - `key`: si la clave está en el `.env` o en la terminal, y si git ignora el `.env`.
     - Por herramienta, si Context7 ya está configurado y el `channel` actual: `context7`, `docs-rag`, `none` o `both` (solo si alguien editó la config a mano; `apply` lo deja en `context7`). `docs-rag` cuenta si está en la config del proyecto.
   - `apply`: escribe el MCP de Context7 en la config de usuario de cada herramienta, quita `docs-rag` de la config del proyecto (y el de usuario de versiones anteriores) y, con `--libs`, la regla del proyecto. Repetirlo no cambia nada.
   - `reset`: quita el MCP de Context7 y la regla.
2. **`--libs a,b,c`** _(Opcional)_: las librerías confirmadas por la persona. Con ellas se escribe el bloque «Context7» en `AGENTS.md` (opencode, Cursor y Codex) o `CLAUDE.md` (Claude Code).
3. **`--with-key`** _(Opcional)_: añade a la config la cabecera `Authorization: Bearer` con la variable `CONTEXT7_API_KEY`, que sale del `.env` de la persona. Sin esta opción no se escribe ninguna cabecera.
4. **`--target opencode|cursor|claude|codex`** _(Opcional)_: una sola herramienta. Por defecto, todas las que tengan carpeta de agentes.

#### Reglas de Invocación Críticas

- **Tú hablas, el script no**: El script nunca pregunta. Las preguntas las haces tú y le pasas las respuestas con `--libs` y `--with-key`.
- **Flujo**:
  1. Lanza `detect`. Si falla porque no hay carpeta de agentes, dile a la persona que ejecute `apm install`. Si no hay manifiestos (`manifests` vacío), di que se buscó en toda la carpeta del proyecto salvo lo que `.gitignore` ignora (sin git, hasta 3 niveles), y ofrece configurar solo el MCP, o que la persona escriba las librerías a mano.
  2. Muestra las dependencias `sugerida` en una tabla con librería, ecosistema y carpeta (de `sources`; si hay varias, la primera y cuántas más). Después, en una línea, las `descartada` con su motivo. Si Context7 ya está configurado en alguna herramienta, dilo. Si el `channel` de alguna es `docs-rag`, avisa de que pasará a Context7 y las consultas volverán a salir a Upstash.
  3. Pregunta **una vez**: «¿Las aceptas? [Enter = sí | nombre de una librería para quitarla o añadir otra]». Repite hasta que acepte.
  4. Mira `key` en la salida de `detect`:
     - Si `key.inEnv` es `true`, la clave ya está en el `.env`: propón usarla con `--with-key`.
     - Si no, pregunta si quiere usar una (gratis en context7.com/dashboard; da más límite de peticiones). Si dice que sí, dile que añada `CONTEXT7_API_KEY=su-clave` a su `.env`, junto a `GITHUB_TOKEN`, y que la añada ella misma: la clave no se pega en el chat, porque quedaría en el historial.
     - Si no la quiere, sigue sin `--with-key`: Context7 funciona sin clave con el límite por defecto.
  5. Lanza `apply --libs LISTA` (con `--with-key` si procede). Muestra una tabla final con herramienta, archivo de configuración, archivo de regla y `result`, y las `notes`.
  6. Recuerda recargar el editor, o la sesión de opencode, Claude Code o Codex, para que cargue el MCP.
- **La clave nunca se escribe en los archivos de config**: El script guarda solo el nombre de la variable. Lee el `.env` únicamente para saber si `CONTEXT7_API_KEY` tiene valor y nunca lo devuelve.
- **El `.env` hay que cargarlo**: opencode, Cursor, Claude Code y Codex no lo leen solos. Las `notes` de `apply` explican cómo cargarlo y avisan si el `.env` no está en `.gitignore`. Con `--with-key` y sin la clave en el `.env` ni en la terminal, la herramienta no podrá autenticarse.
- **Es un servicio de terceros**: El nombre de la librería y el texto de la pregunta salen hacia Upstash. Dilo una vez y mantén secretos y código privado fuera de la consulta.
- **Después de `apm install` o `apm update`**: Los archivos de config MCP de usuario no se tocan. No hace falta repetir `/setup-context7`, salvo que se quieran cambiar las librerías.
- **Procesamiento de respuestas**: El script escribe JSON. `result` vale `cambiado`, `igual` o `ausente`. Si el código de salida no es 0, lee el error y comunícalo; un archivo de configuración con JSON inválido no se modifica. Usa solo las librerías y los resultados que devuelve el script.
