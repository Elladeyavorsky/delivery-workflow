---
name: assign-reviewers
description: "Verifica los logins ya resueltos, pide su revisión en la pull request y la saca de draft. La ejecuta manage-pr al pedir revisión."
---

### ASSIGN_REVIEWERS

La ejecuta `manage-pr` con la PR y los logins ya resueltos. Antes de llamar, `node "<carpeta de esta skill>/scripts/gitlab.mjs" forge` escribe `github` o `gitlab`. Con `gitlab`, sigue «En GitLab». Con `github`, cada llamada a GitHub va por `bash "<carpeta de esta skill>/scripts/gh.sh" ARGUMENTOS`, desde la raíz del repositorio git: lanza `gh` con el `GITHUB_TOKEN` del `.env` del proyecto. Llama a `gh` solo a través de `gh.sh`: `gh` directo usaría otra cuenta. Abajo, `gh.sh` es `bash "<carpeta de esta skill>/scripts/gh.sh"`. La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/assign-reviewers`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

1. Leer autor, borrador y revisores actuales con `gh.sh pr view NUMERO --repo OWNER/REPO --json author,isDraft,reviewRequests`. Excluir al autor y deduplicar logins.
2. Verificar en vivo que cada login sigue siendo colaborador mediante `gh.sh api repos/OWNER/REPO/collaborators/LOGIN`. Ante un rechazo, devuelve el nombre al orquestador: no elijas otra persona.
3. Solicitar solo revisores que falten y pasar a lista para revisión cuando se haya pedido. Con `gh.sh pr edit NUMERO --repo OWNER/REPO --add-reviewer LOGIN` y `gh.sh pr ready NUMERO --repo OWNER/REPO` si estaba en borrador.
4. Consultar la PR para confirmar resultado. Si una escritura falla o se interrumpe, leer antes de repetir. Da una revisión por pedida solo cuando la consulta la confirme.

Solo pide revisiones a logins distintos del autor, y no modifica tokens. Un fallo de permisos conserva los alias guardados y no cuenta como revisión pedida.

#### En GitLab

Abajo, `gitlab.mjs` es `node "<carpeta de esta skill>/scripts/gitlab.mjs"`, desde la raíz del repositorio git. Usa el `GITLAB_TOKEN` del `.env` del proyecto. La pull request es el merge request.

1. Leer autor, `isDraft` y `reviewers` con `gitlab.mjs mr view N`.
2. Verificar cada login con `gitlab.mjs member check LOGIN`. Ante un rechazo, devuelve el nombre al orquestador: no elijas otra persona.
3. Pedir la revisión con `gitlab.mjs mr request-review N LOGIN...`. El comando excluye al autor, añade revisores sin quitar los que hay, vuelve a pedirla a quien ya revisó y lee el resultado. Con código 1 nombra a quien queda sin pedir, por ejemplo en un plan que admite un solo revisor: esa revisión no cuenta como pedida.
4. Si quedó alguna revisión pedida y el merge request estaba en draft, `gitlab.mjs mr ready N`. Confirmar con `gitlab.mjs mr view N`.
