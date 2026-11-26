---
name: manage-draft
description: "Pasa a draft una pull request que ya existe. La usa manage-pr al actualizarla. Para crearla usa manage-pr-base, para sacarla de draft ready-pull-request y para pedir revisión assign-reviewers."
---

### Herramienta: MANAGE_DRAFT

- **Descripción**: Pasa una pull request a draft.
- **Forge**: Antes de llamar, `node "<carpeta de esta skill>/scripts/gitlab.mjs" forge` escribe `github` o `gitlab`. Con `github`, usa los comandos de esta skill con `gh.sh`. Con `gitlab`, los de «En GitLab».
- **GitHub**: `bash "<carpeta de esta skill>/scripts/gh.sh" ARGUMENTOS`, desde la raíz del repositorio git. Lanza `gh` con el `GITHUB_TOKEN` del `.env` del proyecto. Usa siempre este script: así la acción queda a nombre de la cuenta del token.
- **Comando**: `bash "<carpeta de esta skill>/scripts/gh.sh" pr ready N --undo`. Para saber si ya está en draft: `bash "<carpeta de esta skill>/scripts/gh.sh" pr view N --json isDraft`.

La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/manage-draft`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

#### En GitLab

Abajo, `gitlab.mjs` es `node "<carpeta de esta skill>/scripts/gitlab.mjs"`, desde la raíz del repositorio git. Usa el `GITLAB_TOKEN` del `.env` del proyecto. La pull request es el merge request.

- **Comando**: `gitlab.mjs mr draft N`. Para saber si ya está en draft: el campo `isDraft` de `gitlab.mjs mr view N`.

#### Especificación de Argumentos

1. **Pull request** : El número o la URL de la pull request de la rama actual.

#### Reglas de Invocación Críticas

- **Procesamiento de respuestas**: Confirma el estado draft. Si ya está en draft, conserva ese estado. Si no existe, comunica el error.
