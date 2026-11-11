---
name: issue-spec
description: "Lee y escribe la spec, el plan y las tasks de una tarea en su issue de GitHub sin tocar la parte de arriba, marca tasks, cambia el estado y comenta cada ronda. La usan el orquestador delivery-workflow y los subagentes del ciclo."
---

### Herramienta: ISSUE_SPEC

- **Descripción**: Úsala para todo lo que el ciclo lee o escribe en la issue: las secciones `## Spec`, `## Plan` y `## Tasks`, las casillas de las tasks, la línea Estado y los comentarios de cada ronda. No la uses para crear la issue ni para cambiar su parte de arriba (la plantilla del tipo).
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/issue-spec.mjs" COMANDO N ...`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/issue-spec`. Requiere Node 20+, `gh` y el `GITHUB_TOKEN` del `.env` del proyecto: el script lanza `gh` con ese token, nunca con la sesión de `gh`.

La forma de las tres secciones está en `<carpeta de esta skill>/assets/spec.md`, `plan.md` y `tasks.md`.

#### Comandos

- `read N [--section top|spec|plan|tasks]`: escribe el cuerpo entero o una sección.
- `top-hash N`: escribe la huella de la parte de arriba. El orquestador la toma al crear la issue y la pasa en cada encargo del ciclo.
- `write N --expect-top HUELLA [--spec F] [--plan F] [--tasks F]`: sustituye solo las secciones indicadas con el contenido de cada fichero, con o sin su encabezado `##`. Las demás se conservan.
- `tick N TASK-NN --expect-top HUELLA`: marca esa task.
- `state N Borrador|Implementada|Fallida --expect-top HUELLA`: cambia la línea Estado de la spec y le pone la fecha de hoy.
- `comment N F`: publica el fichero como comentario de la issue.

#### Reglas de Invocación Críticas

- **Leer antes de escribir**: El script lee el cuerpo justo antes de cada escritura. No guardes una copia del cuerpo entre encargos: pide `read` otra vez.
- **Código 3**: La parte de arriba cambió desde que empezó el ciclo. No se ha escrito nada. Para y devuelve al orquestador qué ibas a escribir, para que pregunte a la persona.
- **Código 4**: El texto parece contener un secreto. No se ha escrito nada. Para, nombra el fichero de donde salió y no copies el valor en ninguna respuesta.
- **Código 5**: El cuerpo pasaría de 65 536 caracteres. Acorta el plan y vuelve a escribir. No lo partas en otra issue ni en comentarios.
- **Otro código distinto de 0**: Comunica el texto del error. No edites la issue con otra herramienta para saltarte la comprobación.
