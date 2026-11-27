# GitLab

Lo que cambia al usar el flujo con GitLab. La instalación del paquete es la del [README](../README.md#instalación). En GitLab, la pull request es el merge request.

## Requisitos

Necesitas `curl`. No hace falta `gh`: sáltate los pasos del README que lo instalan.

## Token y forge

1. Crea un token propio con el permiso `api`.
2. Añade esta línea al [fichero `.env`](../README.md#el-fichero-env):

   ```
   GITLAB_TOKEN=tu_token
   ```

La sesión de `glab` y los tokens en variables de la terminal no cuentan.

El flujo usa GitLab cuando `origin` está en `gitlab.com`. En una instancia propia, declara `GIT_WORKFLOW_FORGE=gitlab`. Si la web no está en el host de `origin`, añade `GIT_WORKFLOW_FORGE_URL` con su dirección `https://`. Las dos valen en el entorno o en el `.env`.

Si tu sandbox limita los dominios, permite `gitlab.com` o el host de tu instancia.

## Diferencias con GitHub

- **Cambios pedidos:** los marca un revisor, o queda sin resolver un hilo de alguien distinto del autor.
- **Aprobado:** hay al menos una aprobación y ninguna pendiente.
- **Revisores:** algunos planes admiten solo uno. El flujo nombra a quien queda sin pedir.
- **Cierre de una issue:** GitLab no guarda el motivo.
- **Etiquetas:** crearlas pide el rol Planner o superior. Sin él, la issue y el merge request quedan sin etiqueta.
- **Comandos:** el flujo rechaza una línea nueva que empieza por un comando de GitLab, como `/close`, porque GitLab la ejecutaría. También en bloques de código y comentarios HTML. Con un espacio delante de la barra, la envía. Conserva la que ya estaba guardada sin cambios delante.
- **Tamaño:** 1 048 576 caracteres en la issue y 1 000 000 por comentario. En GitHub, 65 536.
- **Forks:** no se admiten. `check-status` y la creación del merge request avisan.
