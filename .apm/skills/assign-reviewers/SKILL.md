---
name: assign-reviewers
description: "Verifica los logins ya resueltos, pide su revisión en la pull request y la saca de draft. La ejecuta manage-pr al pedir revisión."
---

### ASSIGN_REVIEWERS

La ejecuta `manage-pr` con la PR y los logins de GitHub ya resueltos. Cada llamada a GitHub va por `bash "<carpeta de esta skill>/scripts/gh.sh" ARGUMENTOS`, desde la raíz del repositorio git: lanza `gh` con el `GITHUB_TOKEN` del `.env` del proyecto. Llama a `gh` solo a través de `gh.sh`: `gh` directo usaría otra cuenta. Abajo, `gh.sh` es `bash "<carpeta de esta skill>/scripts/gh.sh"`. La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/assign-reviewers`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

1. Leer autor, borrador y revisores actuales con `gh.sh pr view NUMERO --repo OWNER/REPO --json author,isDraft,reviewRequests`. Excluir al autor y deduplicar logins.
2. Verificar en vivo que cada login sigue siendo colaborador mediante `gh.sh api repos/OWNER/REPO/collaborators/LOGIN`. Ante un rechazo, devuelve el nombre al orquestador: no elijas otra persona.
3. Solicitar solo revisores que falten y pasar a lista para revisión cuando se haya pedido. Con `gh.sh pr edit NUMERO --repo OWNER/REPO --add-reviewer LOGIN` y `gh.sh pr ready NUMERO --repo OWNER/REPO` si estaba en borrador.
4. Consultar la PR para confirmar resultado. Si una escritura falla o se interrumpe, leer antes de repetir. Da una revisión por pedida solo cuando la consulta la confirme.

Solo pide revisiones a logins distintos del autor, y no modifica tokens. Un fallo de permisos conserva los alias guardados y no cuenta como revisión pedida.
