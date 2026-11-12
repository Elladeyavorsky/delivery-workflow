---
name: close-issue
description: "Cierra o reabre una issue a petición de la persona. La usa manage-issue; al terminar una tarea, el merge con Closes #N ya cierra la issue sola."
---

### Herramienta: CLOSE_ISSUE

- **Descripción**: Cierra o reabre una issue cuando la persona lo pide. Al terminar una tarea no hace falta usarla: el merge con `Closes #N` cierra la issue sola.
- **GitHub**: `bash "<carpeta de esta skill>/scripts/gh.sh" ARGUMENTOS`, desde la raíz del repositorio git. Lanza `gh` con el `GITHUB_TOKEN` del `.env` del proyecto. Usa siempre este script: así la acción queda a nombre de la cuenta del token.
- **Estado**: `bash "<carpeta de esta skill>/scripts/gh.sh" issue view N --json state --jq .state`.
- **Cerrar**: `bash "<carpeta de esta skill>/scripts/gh.sh" issue close N --reason "[MOTIVO]"`.
- **Reabrir**: `bash "<carpeta de esta skill>/scripts/gh.sh" issue reopen N`.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/close-issue`.

#### Especificación de Argumentos

1. **Issue** _(Obligatorio)_: El número de la issue.
2. **Acción** _(Obligatorio)_: `cerrar` o `reabrir`.
3. **Motivo** _(Opcional, solo al cerrar)_: `completed` o `not planned`. Por defecto, `completed`.

#### Reglas de Invocación Críticas

- **Estado previo**: Lee el estado con `issue view`. Si ya está en el estado pedido, no cambies nada y dilo.
- **Motivo**: Al cerrar, usa solo `completed` o `not planned`.
- **Procesamiento de respuestas**: Confirma el estado final con `issue view`. Si falla, comunica el error.
