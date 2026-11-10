# El paquete vive en su propio repositorio

Sustituye a la [ADR 0003](0003-paquete-dentro-del-repositorio-de-origen.md). El paquete pasa de `exercises/delivery-workflow-template` en el repositorio de origen, `venturars/neoland-102026`, a la raíz de `venturars/delivery-workflow`, antes de publicar ninguna versión. Se instala con `apm install venturars/delivery-workflow#vX.Y.Z` desde cualquier proyecto, también desde el repositorio de origen y desde otros proyectos del equipo como `aTempo`. El repositorio queda en la misma cuenta que el de origen. Se descartó un fork del repositorio de origen: arrastra todo su contenido y su historial, y la instalación seguiría apuntando a una subcarpeta.

## Consecuencias

- Las etiquetas son del paquete y no llevan prefijo: `v0.1.0` en vez de `delivery-workflow--v0.1.0`.
- El repositorio tiene `staging` para los cambios y `main` para lo publicado. Las etiquetas se ponen en `main`.
- El historial del paquete se trajo con `git subtree split`: los commits anteriores al traslado nombran la issue de origen como `venturars/neoland-102026#1169`.
- La regla de la ADR 0003 sigue: nada del paquete apunta a rutas de otro repositorio.
