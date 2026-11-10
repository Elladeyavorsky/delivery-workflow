---
name: launch-push
description: "Sube la rama de trabajo actual a origin y fija el upstream, sin force push. La usa el orquestador delivery-workflow después del commit vacío, del commit final y de cada trozo guardado."
---

### Herramienta: LAUNCH_PUSH

- **Descripción**: Úsala única y exclusivamente para subir la rama de trabajo actual a `origin` y fijar el upstream, después del commit vacío, del commit final o de un trozo guardado. No la uses para hacer commit ni para abrir la pull request. No la uses en la rama base. No la uses con force push.
- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/launch-push.sh"`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/launch-push`.

#### Especificación de Argumentos

No recibe argumentos. Equivale a `git push -u origin HEAD`.

#### Reglas de Invocación Críticas

- **Antes de lanzarla**: Comprueba que estás en una rama de trabajo, no en la rama base, y que hay al menos un commit que subir.
- **Procesamiento de respuestas**: Si el código de salida es 0, la rama ya está en el remoto con su upstream: responde con la rama y el remoto, y no lances un segundo push. Si no es 0, comunica el mensaje de git. No vuelvas a lanzarla con `--force` ni con `-f`.
