# La spec vive en la issue

La spec, el plan y las tasks de una tarea se escriben en el cuerpo de su issue, en las secciones `## Spec`, `## Plan` y `## Tasks`, debajo de la plantilla del tipo, en vez de en `docs/specs/<cambio>/` como hacen `exercises/ChromaDB` y los proyectos de `staging`. Es un requisito del equipo: la tarea entera se lee en un solo sitio y las tasks son casillas de GitHub. Se descartaron la spec en un comentario (no se edita por secciones), una issue aparte enlazada como sub-issue (dos sitios para una tarea) y dejar el plan y las tasks en ficheros (otra vez dos sitios).

## Consecuencias

- La spec sale de git: no hay commit `docs:` de la spec ni aparece en el diff de la pull request. Su historia es la de ediciones de la issue.
- Cada escritura lee el cuerpo antes, sustituye solo sus tres secciones y para si la parte de arriba cambió desde que empezó el ciclo.
- El cuerpo de una issue admite 65 536 caracteres: un plan largo se acorta, no se parte.
- Cada ronda deja un comentario en la issue, y el informe de una novena ronda fallida también es un comentario.
- La issue es pública en un repositorio público: el bloqueo de secretos vale también para lo que se escribe en ella.
- Los subagentes del ciclo necesitan `gh` con sesión para leer su encargo.
