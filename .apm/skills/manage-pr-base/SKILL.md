---
name: manage-pr-base
description: "Abre la pull request de la rama de trabajo contra la rama base, en draft, asignada a la cuenta del token y con la etiqueta del tipo, en una sola llamada. Úsala desde el subagente manage-pr."
---

### Herramienta: MANAGE_PR_BASE

- **Descripción**: Úsala desde el subagente `manage-pr` para abrir la pull request contra la rama base, directamente en draft, asignada a la cuenta del token y con la etiqueta del tipo, en una misma invocación. Para enlazar la issue, usa `link-pr-to-issue`.
- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/manage-pr-base.sh" "[RAMA]" "[TITULO]" "[CUERPO]" "[TIPO]" "[BASE]"`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/manage-pr-base`; en Claude Code, `${CLAUDE_SKILL_DIR}`. En GitHub requiere GitHub CLI y el `GITHUB_TOKEN` del `.env` del proyecto: la cuenta del token será el autor de la PR y `--assignee "@me"` la persona asignada. El script usa el token del `.env`, no la sesión de `gh`.

En GitLab el comando es el mismo y abre un merge request, en draft por el prefijo `Draft:` del título, con `curl` y el `GITLAB_TOKEN` del `.env`. Una línea del cuerpo que empiece por un comando de GitLab, como `/close`, se rechaza, también dentro de un bloque de código, porque GitLab la ejecutaría: pon un espacio delante de la barra.

GitLab no admite forks en este flujo: en un fork, el script avisa, y no ve ni abre merge requests hacia el proyecto original. Comunica el aviso.

Fuente de la forma del cuerpo: [github-pr](https://www.skills.sh/gentleman-programming/gentleman-skills/github-pr), adaptada a este paquete.

#### Especificación de Argumentos

1. **RAMA** _(Obligatorio)_: La rama subida, que se pasa como `--head`.
2. **TITULO** _(Obligatorio)_: El título de la issue, con su misma forma: En inglés, de menos de 72 caracteres, empieza por un verbo en imperativo con mayúscula (`Add`, `Fix`, `Document`…), sin el tipo delante, sin número de issue y sin punto final. Ejemplo: `Add a delivery-workflow test note`, no `docs: añadir nota de prueba`. Si te llega en español o con el tipo delante, tradúcelo y reescríbelo antes de seguir. El script lo comprueba con `check-title.sh` y no abre la PR si no pasa.
3. **CUERPO** _(Obligatorio)_: Ruta de un fichero temporal con la descripción en español y la plantilla del tipo, `<carpeta de esta skill>/assets/<tipo>-pull-request.md`. Deja la sección Issue con `Closes #` sin número: lo completa `link-pr-to-issue`. Nombra la issue solo en la línea `Closes #`: en el resto del cuerpo no hace falta ni el número ni «la issue #N». Si el tipo no tiene plantilla, usa la más cercana.
4. **TIPO** _(Obligatorio)_: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`. Es también la etiqueta.
5. **BASE** _(Opcional)_: La base con la que se creó la rama, si no es la rama base detectada.

#### Reglas de Invocación Críticas

- **Etiqueta**: El script crea la etiqueta del tipo si falta, con `ensure-label.sh`. Si la cuenta no puede crearla, abre la PR sin etiqueta y lo dice: comunícalo.
- **PR existente**: Si ya hay una PR abierta de esa rama hacia la base, el script devuelve su URL sin tocarla. Para actualizarla, usa `edit-pull-request` para el cuerpo y conserva la línea `Closes #N`. Usa `assign-author` y `manage-draft` cuando haga falta.
- **Título**: Si el script dice que el título no vale, corrígelo según el mensaje y vuelve a lanzarlo.
- **Procesamiento de respuestas**: Si el código de salida es 0, devuelve la URL y la base, y confirma draft, asignación y etiqueta. Si falla, comunica el error.
