---
name: edit-pull-request
description: "Edita el título o el cuerpo de una pull request que ya existe, conservando la línea Closes #N. La usa manage-pr cuando el encargo pide cambiarlos."
---

### Herramienta: EDIT_PULL_REQUEST

- **Descripción**: Úsala para cambiar el título o el cuerpo de una pull request que ya existe. Para crearla, usa `manage-pr-base`. Para enlazar la issue, usa `link-pr-to-issue`.
- **GitHub**: `bash "<carpeta de esta skill>/scripts/gh.sh" ARGUMENTOS`, desde la raíz del repositorio git. Lanza `gh` con el `GITHUB_TOKEN` del `.env` del proyecto. Usa siempre este script: así la acción queda a nombre de la cuenta del token.
- **Título**: `bash "<carpeta de esta skill>/scripts/gh.sh" pr edit N --title "[TITULO]"`.
- **Cuerpo**: Antes de cambiarlo, léelo con `bash "<carpeta de esta skill>/scripts/gh.sh" pr view N --json body --jq .body` y escribe el cuerpo nuevo en un fichero temporal. Luego: `bash "<carpeta de esta skill>/scripts/gh.sh" pr edit N --body-file "[FICHERO]"`.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/edit-pull-request`.

#### Especificación de Argumentos

1. **Pull request** _(Obligatorio)_: El número o la URL de la pull request de la rama actual, o la que indique el encargo.
2. **Título** _(Opcional)_: El título nuevo, en el mismo idioma que el título de la issue.
3. **Cuerpo** _(Opcional)_: Ruta de un fichero temporal con el cuerpo completo, en español.

#### Reglas de Invocación Críticas

- **Closes #N**: El cuerpo nuevo conserva la línea `Closes #N` de la sección Issue. Si el cuerpo que llega pierde esa línea, repónla antes de guardarlo. Si el encargo no trae el número de la issue, pídelo al orquestador.
- **Solo lo pedido**: Cambia solo el título o el cuerpo que indica el encargo. El borrador, la asignación y las revisiones no se tocan aquí.
- **Procesamiento de respuestas**: Confirma el título o el cuerpo guardados con `bash "<carpeta de esta skill>/scripts/gh.sh" pr view N --json title,body`. Si falla, comunica el error y deja el cambio pendiente.
