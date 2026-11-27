# GitLab

Qué cambia respecto a GitHub. El token y la elección del forge están en [el README](../README.md#gitlab).

- **Cambios pedidos:** los marca un revisor, o queda sin resolver un hilo de alguien distinto del autor.
- **Aprobado:** hay al menos una aprobación y ninguna pendiente.
- **Revisores:** algunos planes admiten solo uno. El flujo nombra a quien queda sin pedir.
- **Cierre de una issue:** GitLab no guarda el motivo.
- **Etiquetas:** crearlas pide el rol Planner o superior. Sin él, la issue y el merge request quedan sin etiqueta.
- **Comandos:** el flujo rechaza una línea nueva que empieza por un comando de GitLab, como `/close`, porque GitLab la ejecutaría. También en bloques de código y comentarios HTML. Con un espacio delante de la barra, la envía. Conserva la que ya estaba guardada sin cambios delante.
- **Tamaño:** 1 048 576 caracteres en la issue y 1 000 000 por comentario. En GitHub, 65 536.
