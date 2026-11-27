---
name: ready-pull-request
description: "Saca de draft una pull request que ya existe, sin pedir revisión. La usa manage-pr cuando el encargo pide dejarla lista; para volver a draft, usa manage-draft."
---

### Herramienta: READY_PULL_REQUEST

- **Descripción**: Saca una pull request de draft. No pide revisores: para eso está `assign-reviewers`. Para volver a draft, usa `manage-draft`.
- **Forge**: Antes de llamar, `node "<carpeta de esta skill>/scripts/gitlab.mjs" forge` escribe `github` o `gitlab`. Con `github`, usa los comandos de esta skill con `gh.sh`. Con `gitlab`, los de «En GitLab».
- **GitHub**: `bash "<carpeta de esta skill>/scripts/gh.sh" ARGUMENTOS`, desde la raíz del repositorio git. Lanza `gh` con el `GITHUB_TOKEN` del `.env` del proyecto. Usa siempre este script: así la acción queda a nombre de la cuenta del token.
- **Comando**: `bash "<carpeta de esta skill>/scripts/gh.sh" pr ready N`. Para saber si ya está lista: `bash "<carpeta de esta skill>/scripts/gh.sh" pr view N --json isDraft`.

La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/ready-pull-request`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

#### En GitLab

Abajo, `gitlab.mjs` es `node "<carpeta de esta skill>/scripts/gitlab.mjs"`, desde la raíz del repositorio git. Usa el `GITLAB_TOKEN` del `.env` del proyecto. La pull request es el merge request.

- **Comando**: `gitlab.mjs mr ready N`. Para saber si ya está listo: el campo `isDraft` de `gitlab.mjs mr view N`.

#### Especificación de Argumentos

1. **Pull request** _(Obligatorio)_: El número o la URL de la pull request de la rama actual, o la que indique el encargo.

#### Reglas de Invocación Críticas

- **Antes de sacarla**: Comprueba con `pr view N --json isDraft` si ya está lista. Si lo está, conserva ese estado.
- **Revisiones**: Sacarla de draft no pide ninguna revisión. Si el encargo también pide revisión, eso lo hace `assign-reviewers`.
- **Procesamiento de respuestas**: Confirma `isDraft: false`. Si falla, comunica el error.
