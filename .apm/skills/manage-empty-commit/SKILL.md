---
name: manage-empty-commit
description: "Crea el commit vacío de apertura `chore: open #N` en la rama de trabajo. Úsala al empezar; para guardar ficheros, usa commit-changes."
---

### Herramienta: MANAGE_EMPTY_COMMIT

- **Descripción**: Úsala para el commit vacío de apertura, `chore: open #N`. Para guardar ficheros, usa `commit-changes`.
- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/manage-empty-commit.sh" "[NUMERO]"`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/manage-empty-commit`.

Fuente del mensaje: el tipo `chore` de [github-pr](https://www.skills.sh/gentleman-programming/gentleman-skills/github-pr).

#### Especificación de Argumentos

1. **NUMERO** _(Obligatorio)_: El número de la issue, solo dígitos. El script escribe el mensaje `chore: open #N`.

#### Reglas de Invocación Críticas

- **Procesamiento de respuestas**: Si el código de salida es 0, el commit vacío ya está en la rama y no incluye ficheros preparados. Si no es 0, comunica el texto de git. El mensaje es siempre `chore: open #N`. El script rechaza la rama base, `staging`, `main` o `master`: el commit va en la rama de trabajo.
