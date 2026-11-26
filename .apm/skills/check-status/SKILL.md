---
name: check-status
description: "Resume la rama actual, la rama base, si el .env tiene el token del forge, la cuenta del token y Node 24+, el remoto y los cambios sin commit. Úsala antes de elegir el momento."
---

### Herramienta: CHECK_STATUS

- **Descripción**: Úsala cuando necesites saber la rama actual, la rama base, si hay cambios sin commit, si la rama sigue a un remoto, si el `.env` del proyecto tiene el token del forge, de qué cuenta es, si está Node 24+ y si los agentes tienen modelo.

- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/check-status.sh"`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/check-status`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

#### Especificación de Argumentos

No recibe argumentos.

#### Reglas de Invocación Críticas

- **Procesamiento de respuestas**: El script escribe, en este orden, el repositorio, la rama, la rama base, el token de GitHub y GitHub CLI (en GitLab, `Forge:` con el host, el token de GitLab y la cuenta), Node, los modelos de los agentes (`Modelos:`: sin configurar, configurado o desincronizado), el remoto con los commits por subir y por bajar, el último commit, la pull request abierta de esta rama si hay token (número, `reviewDecision` e issue de `Closes #N`), los ficheros preparados, los modificados sin preparar y los que no tienen seguimiento. Si el código de salida no es 0, lee el error y comunícalo. Toma la rama y los ficheros solo de la salida del script. Si la línea de la pull request dice `CHANGES_REQUESTED` y una issue, el momento es cambios pedidos.
- **Forge**: Sale de `GIT_WORKFLOW_FORGE` (`github` o `gitlab`), del entorno o del `.env`. Sin ella, un `origin` en `gitlab.com` es GitLab y cualquier otro host es GitHub. En una instancia propia de GitLab se declara `GIT_WORKFLOW_FORGE=gitlab`, y `GIT_WORKFLOW_FORGE_URL` da la dirección `https://` cuando la web no está en el host de `origin`. GitHub usa `GITHUB_TOKEN` y GitLab usa `GITLAB_TOKEN`.
- **Cambios pedidos en GitLab**: La línea dice `CHANGES_REQUESTED` si un revisor pidió cambios o si queda sin resolver un hilo abierto por alguien distinto del autor. Sigue así hasta que se resuelve. Dice `APPROVED` con alguna aprobación y ninguna pendiente.
- **Forks en GitLab**: No se admiten. Si sale el aviso de fork, comunícalo: el flujo no ve ni abre merge requests hacia el proyecto original.
- **Si falla algo en GitLab**: Si falta `GITLAB_TOKEN`, la persona lo añade al `.env`, que va en `.gitignore`, con un token propio con permiso `api`. Si faltan `curl` o Node, pide que los instale. La sesión de `glab` y las variables del entorno con tokens no cuentan.
- **Si una línea `Forge:` trae un error**: Comunícalo antes de seguir.
- **Si la rama base no se detecta**: Pide a la persona que defina `GIT_WORKFLOW_BASE` con el nombre de su rama base.
- **Si falta el token de GitHub**: Todo lo que toca GitHub va a fallar. Repite a la persona el error del script: tiene que crear un `.env` en la raíz del proyecto con `GITHUB_TOKEN=su_token`, con un token de su propia cuenta, y tener `.env` en `.gitignore`. No hace falta reiniciar nada: los scripts leen el `.env` en cada llamada. Usa solo el token del `.env`: el inicio de sesión de `gh` y las variables del entorno no cuentan.
- **Si GitHub rechaza el token**: Pide a la persona que cree otro token y lo cambie en el `.env`.
- **Si `Modelos:` dice «sin configurar» o «desincronizado»**: No es un error y no bloquea nada. Dilo una vez: los agentes usan el modelo del chat, y para elegir uno la persona ejecuta `/configure-models` (tras `apm install` o `apm update` se vuelven a poner las líneas de modelo que `apm install` borra). Si dice «no se pudo comprobar», sigue. Si la línea dice que los agentes de opencode aún llevan `skills:`, di además que ejecute `/configure-models` antes de usar el flujo: un proveedor `openai-compatible` puede rechazar ese campo.
- **Si falta `gh` (en GitHub) o Node 24+**: La issue, la pull request, las etiquetas, la spec en la issue y la caché de revisores van a fallar. Pide a la persona que los instale antes de dejar la tarea escrita.
