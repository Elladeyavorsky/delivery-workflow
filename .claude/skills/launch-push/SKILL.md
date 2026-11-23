---
name: launch-push
description: "Sube la rama de trabajo actual a origin y fija el upstream, sin force push. La usa el orquestador delivery-workflow después del commit vacío, del commit final y de cada trozo guardado."
---

### Herramienta: LAUNCH_PUSH

- **Descripción**: Úsala para subir la rama de trabajo actual a `origin` y fijar el upstream, después del commit vacío, del commit final o de un trozo guardado. El commit lo hacen `manage-commit` y la pull request `manage-pr`. Se usa fuera de la rama base y sin force push.
- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/launch-push.sh"`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/launch-push`.

#### Especificación de Argumentos

No recibe argumentos. Equivale a `git push -u origin HEAD`.

#### Reglas de Invocación Críticas

- **Antes de lanzarla**: Comprueba que estás en una rama de trabajo distinta de la rama base y que hay al menos un commit que subir.
- **Procesamiento de respuestas**: Si el código de salida es 0, la rama ya está en el remoto con su upstream: responde con la rama y el remoto. Un segundo push no hace falta. Si no es 0, comunica el mensaje de git. Si el push falla, espera la decisión de la persona: un `--force` reescribe el remoto, y esa decisión es suya.
