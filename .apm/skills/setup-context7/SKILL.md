---
name: setup-context7
description: "Configura Context7 (documentación actual de librerías) en Cursor, Claude Code y Codex: mira las dependencias del proyecto, sugiere para cuáles usarlo y deja el MCP y la regla del proyecto listos. Úsala tras apm install, o cuando la persona quiera que los agentes lean la documentación real de sus librerías."
---

### Herramienta: SETUP_CONTEXT7

- **Descripción**: Úsala única y exclusivamente para configurar Context7 con la persona: leer las dependencias del proyecto, sugerir para cuáles consultarlo, escribir el MCP en cada herramienta y dejar una regla en el proyecto. Sin esta configuración los agentes funcionan igual, pero sin la documentación al día de las librerías. Funciona con Cursor, Claude Code y Codex.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/setup-context7.mjs" ORDEN [OPCIONES]`, desde la raíz del repositorio.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/setup-context7`.

#### Especificación de Argumentos

1. **Orden** _(Obligatorio)_:
   - `detect`: devuelve las dependencias del proyecto (`sugerida`, o `descartada` con su motivo), los manifiestos leídos (en la raíz y en subcarpetas de hasta 3 niveles; cada dependencia trae `sources` con los archivos de donde sale, y un manifiesto ilegible trae `error` sin parar el resto), `key` (si la clave está en el `.env` o en la terminal, y si git ignora el `.env`) y, por herramienta, si Context7 ya está configurado. No escribe nada.
   - `apply`: escribe el MCP de Context7 en cada herramienta y, con `--libs`, la regla del proyecto. Repetirlo no cambia nada.
   - `reset`: quita el MCP de Context7 y la regla.
2. **`--libs a,b,c`** _(Opcional)_: las librerías confirmadas por la persona. Con ellas se escribe el bloque «Context7» en `AGENTS.md` (Cursor y Codex) o `CLAUDE.md` (Claude Code).
3. **`--with-key`** _(Opcional)_: añade a la config la cabecera `Authorization: Bearer` con la variable `CONTEXT7_API_KEY`, que sale del `.env` de la persona. Sin esta opción no se escribe ninguna cabecera.
4. **`--target cursor|claude|codex`** _(Opcional)_: una sola herramienta. Por defecto, todas las que tengan carpeta de agentes.

#### Reglas de Invocación Críticas

- **Tú hablas, el script no**: El script nunca pregunta. Las preguntas las haces tú y le pasas las respuestas con `--libs` y `--with-key`.
- **Flujo**:
  1. Lanza `detect`. Si falla porque no hay carpeta de agentes, dile a la persona que ejecute `apm install`. Si no hay manifiestos (`manifests` vacío), di que se buscó en la raíz y en las subcarpetas hasta 3 niveles, y ofrece configurar solo el MCP, o que la persona escriba las librerías a mano.
  2. Muestra las dependencias `sugerida` en una tabla con librería, ecosistema y carpeta (de `sources`; si hay varias, la primera y cuántas más). Después, en una línea, las `descartada` con su motivo. Si Context7 ya está configurado en alguna herramienta, dilo.
  3. Pregunta **una vez**: «¿Las aceptas? [Enter = sí | nombre de una librería para quitarla o añadir otra]». Repite hasta que acepte.
  4. Mira `key` en la salida de `detect`. Si `key.inEnv` es `true`, la clave ya está en el `.env`: propón usarla con `--with-key`. Si no, pregunta si quiere usar una (gratis en context7.com/dashboard; da más límite de peticiones). Si dice que sí, dile que añada `CONTEXT7_API_KEY=su-clave` a su `.env`, junto a `GITHUB_TOKEN`, y que lo haga ella misma: no le pidas la clave ni la pegues en el chat. Si no la quiere, no pases la opción: Context7 funciona sin clave con el límite por defecto.
  5. Lanza `apply --libs LISTA` (con `--with-key` si procede). Muestra una tabla final con herramienta, archivo de configuración, archivo de regla y `result`, y las `notes`.
  6. Recuerda recargar el editor, o la sesión de Claude Code o Codex, para que cargue el MCP.
- **La clave nunca se escribe en los archivos de config**: El script guarda solo el nombre de la variable. Lee el `.env` únicamente para saber si `CONTEXT7_API_KEY` tiene valor y nunca lo devuelve. Cursor, Claude Code y Codex no leen el `.env` solos: la persona lo carga antes de abrir el editor (`set -a; source .env; set +a`, y abrir el editor desde esa misma terminal). Las `notes` de `apply` se lo recuerdan, y avisan si el `.env` no está en `.gitignore`. Con `--with-key` y sin la clave en el `.env` ni en la terminal, la herramienta no podrá autenticarse.
- **Es un servicio de terceros**: El nombre de la librería y el texto de la pregunta salen hacia Upstash. Dilo una vez y no metas secretos ni código privado en una consulta.
- **Después de `apm install` o `apm update`**: Los archivos de config MCP no se tocan. No hace falta repetir `/setup-context7`, salvo que se quieran cambiar las librerías.
- **Procesamiento de respuestas**: El script escribe JSON. `result` vale `cambiado`, `igual` o `ausente`. Si el código de salida no es 0, lee el error y comunícalo; un archivo de configuración con JSON inválido no se modifica. No inventes librerías ni resultados.
