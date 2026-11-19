---
name: manage-branch
description: "Crea la rama de trabajo número-tipo-descripcion desde la rama base detectada o desde otra base. Úsala al empezar; para commits usa manage-commit y para la pull request, manage-pr."
---

### Herramienta: MANAGE_BRANCH

- **Descripción**: Úsala cuando hay que abrir la rama `número-tipo-descripcion`. Sin base, sale de la rama base detectada. Para guardar un commit o abrir la pull request, usa `manage-commit` y `manage-pr`.
- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/manage-branch.sh" "[NUMERO]" "[TIPO]" "[DESCRIPCION]" "[BASE]"`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/manage-branch`.

#### Especificación de Argumentos

1. **NUMERO** _(Obligatorio)_: El número de la issue, solo dígitos.
2. **TIPO** _(Obligatorio)_: El tipo de la tarea: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`. El script rechaza cualquier otro.
3. **DESCRIPCION** _(Obligatorio)_: Palabras en inglés, en minúsculas, separadas por guiones. Sin espacios.
4. **BASE** _(Opcional)_: La rama de partida, local (`main`) o remota (`origin/main`). Si no se pasa, el script usa la rama base: `GIT_WORKFLOW_BASE` si está definida, si no `staging` si existe en `origin`, y si no la rama por defecto del remoto.

El nombre resultante es `número-tipo-descripcion`.

#### Reglas de Invocación Críticas

- **Escapado de caracteres**: Si un argumento contiene comillas dobles (`"`), escápalas como `\"`.
- **Procesamiento de respuestas**: El script escribe el nombre de la rama y la base usada. Si el código de salida no es 0, lee el error. Si la rama ya existía, el script se queda en ella: sigue desde ahí.
