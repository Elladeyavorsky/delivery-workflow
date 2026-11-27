---
name: issue-spec
description: "Lee y escribe la spec, el plan y las tasks de una tarea en su issue del forge sin tocar la parte de arriba, marca tasks, cambia el estado y comenta cada ronda. También lee las revisiones de la PR y escribe spec, plan y tasks en un comentario de revisión. La usan el orquestador delivery-workflow y los subagentes del ciclo."
---

### Herramienta: ISSUE_SPEC

- **Descripción**: Úsala para todo lo que el ciclo lee o escribe en la issue: las secciones `## Spec`, `## Plan` y `## Tasks`, las casillas de las tasks, la línea Estado y los comentarios de cada ronda. Con `--revision` opera sobre el último comentario `<!-- Revisión N -->` y no toca el cuerpo. Para crear la issue usa `manage-issue`. La parte de arriba (la plantilla del tipo) no la cambia esta skill.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/issue-spec.mjs" COMANDO N ...`

El comando se lanza desde la raíz del repositorio git. La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/issue-spec`; en Claude Code, `${CLAUDE_SKILL_DIR}`. Requiere Node 24+. En GitHub, además `gh` y el `GITHUB_TOKEN` del `.env` del proyecto: el script lanza `gh` con ese token, no con la sesión de `gh`. En GitLab, `curl` y el `GITLAB_TOKEN` del `.env`: los comandos son los mismos, los comentarios de sistema quedan fuera y la pull request es el merge request.

La forma de las tres secciones está en `<carpeta de esta skill>/assets/spec.md`, `plan.md` y `tasks.md`. Un comentario de revisión rellena esas mismas plantillas. Encima solo va `<!-- Revisión N -->`, que es su parte de arriba.

#### Comandos

- `read N [--revision] [--section top|spec|plan|tasks]`: escribe el cuerpo entero o una sección. Con `--revision`, el último comentario de revisión.
- `can-edit N`: escribe `yes` si la cuenta del token puede editar el cuerpo de la issue y `no` si no (la issue es de otra persona y la cuenta no tiene permiso de escritura, como en un fork). En GitLab puede editarla quien la creó, quien la tiene asignada y el rol Planner o superior. Con `no`, publica la spec con `revision` y opera con `--revision`.
- `top-hash N [--revision]`: escribe la huella de la parte de arriba. El orquestador la toma al crear la issue (o al publicar la revisión) y la pasa en cada encargo del ciclo.
- `write N --expect-top HUELLA [--revision] [--spec F] [--plan F] [--tasks F]`: sustituye solo las secciones indicadas con el contenido de cada fichero, con o sin su encabezado `##`. Las demás se conservan.
- `tick N TASK-NN --expect-top HUELLA [--revision]`: marca esa task.
- `state N Borrador|Implementada|Fallida --expect-top HUELLA [--revision]`: cambia la línea Estado de la spec y le pone la fecha de hoy.
- `comment N F`: publica el fichero como comentario de la issue. Debe empezar por otra cosa que `<!-- Revisión`, que reserva la cabecera de los comentarios de revisión.
- `reviews N`: escribe el texto de la revisión de la PR abierta que cierra la issue: decisión, cuerpos que piden cambios y comentarios de línea sin resolver. En GitLab añade quién pide cambios, que es quien lo marcó en su revisión y quien abrió un hilo sin resolver, y escribe también sus comentarios generales. Si la instancia no dice quién marcó cambios, escribe los comentarios generales de cualquiera que no sea el autor. Cada comentario general lleva su fecha: GitLab no los marca como resueltos, así que uno anterior a la última vuelta puede estar ya atendido.
- `revision N F`: publica el fichero como comentario de revisión. Si no trae `<!-- Revisión N -->`, lo añade. Devuelve la huella de esa cabecera.

#### Reglas de Invocación Críticas

- **Leer antes de escribir**: El script lee el cuerpo (o el comentario de revisión) justo antes de cada escritura. En cada encargo pide `read` otra vez, en vez de guardar una copia.
- **`--revision`**: El ciclo de cambios pedidos lo lleva en `read`, `write`, `tick`, `state` y `top-hash`. Sin `--revision`, se opera sobre el cuerpo de la issue.
- **Código 3**: La parte de arriba cambió desde que empezó el ciclo. No se ha escrito nada. Para y devuelve al orquestador qué ibas a escribir, para que pregunte a la persona.
- **Código 4**: El texto parece contener un secreto. No se ha escrito nada. Para, nombra el fichero de donde salió y deja el valor fuera de cualquier respuesta.
- **Código 5**: El cuerpo (o el comentario de revisión) pasaría del límite: 65 536 caracteres en GitHub; en GitLab, 1 048 576 en la issue y 1 000 000 en un comentario. Acorta el plan y vuelve a escribir. Acórtalo en la misma issue: el texto no se reparte en otras issues ni en comentarios.
- **Código 6**: La cuenta no puede editar el cuerpo de la issue. No se ha escrito nada. Publica la spec con `revision` y sigue con `--revision`.
- **Línea con un comando en GitLab**: GitLab ejecutaría una línea que empieza por uno de sus comandos, como `/close`. El script rechaza una línea así, también en un bloque de código o un comentario HTML: no se escribe nada y sale con 1. Pon un espacio delante de la barra. Se conserva la que ya estaba guardada sin cambios desde el principio del texto hasta la línea siguiente, como en la parte de arriba de la issue.
- **Otro código distinto de 0**: Comunica el texto del error. Edita la issue solo con este script: es el que comprueba la huella.
