---
name: assign-author
description: "Asigna una issue o una pull request a la cuenta del token de GitHub del proyecto. Úsala para el autor; para revisores, usa assign-reviewers."
---

### Herramienta: ASSIGN_AUTHOR

- **Descripción**: Úsala para asignar la issue o la pull request a la cuenta del token. Para asignar revisores, usa `assign-reviewers`.
- **GitHub**: `bash "<carpeta de esta skill>/scripts/gh.sh" ARGUMENTOS`, desde la raíz del repositorio git. Lanza `gh` con el `GITHUB_TOKEN` del `.env` del proyecto. Usa siempre este script: así la asignación queda a nombre de la cuenta del token.
- **Issue**: `bash "<carpeta de esta skill>/scripts/gh.sh" issue edit N --add-assignee @me`.
- **Pull request**: `bash "<carpeta de esta skill>/scripts/gh.sh" pr edit N --add-assignee @me`.
- **Login**: `bash "<carpeta de esta skill>/scripts/gh.sh" api user --jq .login`.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/assign-author`.

#### Especificación de Argumentos

1. **Objetivo** _(Obligatorio)_: El número de la issue o de la pull request.
2. **Persona** _(Obligatorio)_: `@me`, la cuenta del token. Es el único valor válido.

#### Reglas de Invocación Críticas

- **Procesamiento de respuestas**: Confirma el login que quedó asignado. Si `gh` falla, comunica el error y deja la asignación pendiente.
