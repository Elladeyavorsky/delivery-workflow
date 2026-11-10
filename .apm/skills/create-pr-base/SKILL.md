---
name: create-pr-base
description: "Abre la pull request de la rama de trabajo contra la rama base, en draft, asignada al usuario autenticado y con la etiqueta del tipo, en una sola llamada. Úsala desde el subagente create-pr."
---

### Herramienta: CREATE_PR_BASE

- **Descripción**: Úsala desde el subagente `create-pr` para abrir la pull request contra la rama base, directamente en draft, asignada al usuario autenticado y con la etiqueta del tipo, en una misma invocación. No la uses para enlazar la issue: eso es `link-pr-to-issue`.
- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/create-pr-base.sh" "[RAMA]" "[TITULO]" "[CUERPO]" "[TIPO]" "[BASE]"`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/create-pr-base`. Requiere GitHub CLI autenticado: esa cuenta será el autor de la PR y `--assignee "@me"` la persona asignada.

Fuente de la forma del cuerpo: [github-pr](https://www.skills.sh/gentleman-programming/gentleman-skills/github-pr), adaptada a este paquete.

#### Especificación de Argumentos

1. **RAMA** _(Obligatorio)_: La rama subida, que se pasa como `--head`.
2. **TITULO** _(Obligatorio)_: El título de la issue.
3. **CUERPO** _(Obligatorio)_: Ruta de un fichero temporal con la descripción en español y la plantilla del tipo, `<carpeta de esta skill>/assets/<tipo>-pull-request.md`. Deja la sección Issue con `Closes #` sin número: lo completa `link-pr-to-issue`. Si el tipo no tiene plantilla, usa la más cercana.
4. **TIPO** _(Obligatorio)_: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`. Es también la etiqueta.
5. **BASE** _(Opcional)_: La base con la que se creó la rama, si no es la rama base detectada.

#### Reglas de Invocación Críticas

- **Etiqueta**: El script crea la etiqueta del tipo si falta, con `ensure-label.sh`. Si la cuenta no puede crearla, abre la PR sin etiqueta y lo dice: comunícalo.
- **PR existente**: Si ya hay una PR abierta de esa rama hacia la base, el script devuelve su URL sin tocarla. Para actualizarla, edita el cuerpo con el MCP `github` conservando la línea `Closes #N`, y usa `assign-author` y `create-draft` cuando haga falta.
- **Procesamiento de respuestas**: Si el código de salida es 0, devuelve la URL y la base, y confirma draft, asignación y etiqueta. Si falla, comunica el error.
