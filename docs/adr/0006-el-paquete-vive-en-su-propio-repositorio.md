# El paquete vive en su propio repositorio

Sustituye a la [ADR 0003](0003-paquete-dentro-del-repositorio-del-curso.md). El paquete pasa de `exercises/delivery-workflow-template` en el repositorio del curso a la raíz de `venturars/delivery-workflow`, antes de publicar ninguna versión. Se instala con `apm install venturars/delivery-workflow#vX.Y.Z` desde cualquier proyecto, también desde el repositorio del curso y desde proyectos de alumnos como `aTempo`. El repositorio queda en la cuenta del curso porque el paquete es material del bootcamp. Se descartó un fork del repositorio del curso: arrastra las carpetas de todos los alumnos y su historial, y la instalación seguiría apuntando a una subcarpeta.

## Consecuencias

- Las etiquetas son del paquete y no llevan prefijo: `v0.1.0` en vez de `delivery-workflow--v0.1.0`.
- El repositorio tiene `staging` para los cambios y `main` para lo publicado. Las etiquetas se ponen en `main`.
- El historial del paquete se trajo con `git subtree split`: los commits anteriores al traslado nombran la issue del curso como `venturars/neoland-102026#1169`.
- La regla de la ADR 0003 sigue: nada del paquete apunta a rutas de otro repositorio.
