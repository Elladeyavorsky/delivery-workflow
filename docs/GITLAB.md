# GitLab

El flujo funciona con GitHub y con GitLab. El token y la elección del forge están en [el README](../README.md#gitlab). En GitLab, la pull request es el merge request.

> **Nota:** El camino de GitLab no se ha probado en un GitLab real, solo contra uno simulado: puede fallar con un servidor de verdad.

## Qué cambia respecto a GitHub

- **Cambios pedidos:** un merge request cuenta como cambios pedidos si un revisor lo marca o si queda sin resolver un hilo de alguien distinto del autor.
- **Aprobado:** `APPROVED` pide alguna aprobación y que no queden aprobaciones pendientes.
- **Revisores:** algunos planes admiten un solo revisor. El flujo nombra a quien queda sin pedir.
- **Cierre de una issue:** GitLab no guarda el motivo.
- **Etiquetas:** crearlas pide el rol Planner o superior. Sin permiso, la issue y el merge request se crean sin etiqueta.
- **Comandos de GitLab:** el flujo rechaza una línea nueva que empieza por un comando de GitLab, como `/close`, porque GitLab la ejecutaría. También en un bloque de código o un comentario HTML. Con un espacio delante de la barra, se envía. Una línea así que ya estaba guardada, sin cambios delante, se conserva.
- **Tamaño:** la issue admite 1 048 576 caracteres y un comentario 1 000 000. En GitHub, el límite es 65 536.
- **Forks:** no se admiten. `check-status` y la creación del merge request avisan.
- **Avisos de Discord:** son solo de GitHub.
