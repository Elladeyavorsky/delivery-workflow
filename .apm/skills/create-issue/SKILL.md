---
name: create-issue
description: "Crea la issue en GitHub con la plantilla de su tipo, la etiqueta del tipo y asignada al usuario autenticado. Úsala para dejar la tarea escrita."
---

### Herramienta: CREATE_ISSUE

- **Descripción**: Úsala única y exclusivamente para dejar la tarea escrita en GitHub. No la uses para abrir la rama ni la pull request.
- **MCP**: El servidor MCP `github`, declarado en `apm.yml`.
- **Etiqueta**: `bash "<carpeta de esta skill>/scripts/ensure-label.sh" "[TIPO]"`, desde la raíz del repositorio git, antes de crear la issue.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/create-issue`.

#### Especificación de Argumentos

1. **Tipo** _(Obligatorio)_: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`. Ningún otro.
2. **Título** _(Obligatorio)_: El título. La forma está en la plantilla del tipo.
3. **Cuerpo** _(Obligatorio)_: Español. Rellena la plantilla del tipo, `<carpeta de esta skill>/assets/<tipo>_issue.md`, con «Qué hay que hacer» y «Cómo probarlo». Si el tipo no tiene plantilla, usa la más cercana. Si la persona nombró revisores, añade al final una línea `Revisan: nombre, nombre`.
4. **Persona asignada** _(Obligatorio)_: El usuario autenticado en el MCP.
5. **Etiqueta** _(Obligatorio si existe)_: El nombre exacto del tipo.

#### Reglas de Invocación Críticas

- **Etiqueta**: Si `ensure-label.sh` sale con 0, la issue lleva la etiqueta del tipo. Si sale con 2, la cuenta no puede crearla: crea la issue sin etiqueta y dilo. Si sale con 1, el tipo no vale: no crees la issue.
- **Sin spec**: No escribas `## Spec`, `## Plan` ni `## Tasks`. Esas secciones las añade `concept-developer` debajo de la plantilla.
- **Procesamiento de respuestas**: Quédate con el número, el título, la URL y la etiqueta. Si el MCP devuelve un error, comunícalo y no inventes el número.
