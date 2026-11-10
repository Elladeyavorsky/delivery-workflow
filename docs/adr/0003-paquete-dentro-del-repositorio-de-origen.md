# El paquete vive dentro del repositorio de origen

> Sustituida por [ADR 0006](0006-el-paquete-vive-en-su-propio-repositorio.md) antes de publicar ninguna versión.

El paquete se instala desde una subcarpeta del repositorio donde nació (`venturars/neoland-102026/exercises/delivery-workflow-template`) en vez de tener un repositorio propio, para no crear y mantener otro repositorio mientras el paquete solo se usa ahí. APM solo descarga esa subcarpeta, así que el tamaño del repositorio no pesa. El precio es que la instalación depende de que el repositorio siga siendo público y la carpeta no cambie de sitio, y que las etiquetas de versión se comparten con todo el repositorio y por eso llevan prefijo: `delivery-workflow--vX.Y.Z`.

## Consecuencias

- Pasar a un repositorio propio es copiar la carpeta y cambiar una línea de instalación. Es el siguiente paso si el paquete se usa fuera de ese repositorio.
- Nada del paquete puede apuntar a rutas del repositorio de origen (`exercises/...`): al instalarse en otro proyecto no existen. Los scripts se llaman desde la carpeta de su skill y la caché de revisores vive en `.git/`, no en la raíz.
