# Avisos de revisión de PR en Discord

La acción compuesta de `.github/actions/discord-pr-notifications/` verifica una PR hacia la base configurada y publica una línea separadora, el repositorio, el título, el enlace y los revisores solicitados en GitHub. Cada parte lleva un icono. No incluye el cuerpo de la PR ni ejecuta su código. Publica cuando hay al menos el mínimo de revisores pedidos, aunque ninguno tenga relación conocida con Discord; menciona solo a los verificados y muestra los demás logins como «sin mención de Discord». Si no se pasa `minimum-reviewers`, el mínimo sigue siendo dos. Si una relación se confirma más tarde, envía un aviso adicional solo para esa persona.

## Activación optativa y nombres distintos

Ninguna skill ni agente del paquete consulta Discord o condiciona una solicitud de revisión. Instalar el paquete mediante APM no instala estos workflows: cada repositorio opta por ellos al añadir sus archivos de `.github/workflows/` y configurar el entorno protegido. `delivery-workflow` los incluye para sus propias PR; aTempo puede activar la misma acción desde un workflow fijado al SHA completo de un commit confiable del paquete.

El administrador puede definir la variable opcional `DISCORD_USER_MAP` del entorno protegido con un objeto JSON como `{"login-github":"ID_DE_DISCORD"}`, sustituyendo el marcador por un ID numérico real. La acción lo recibe mediante el input `user-map`: comprueba el formato de todas las entradas y valida que el ID del revisor pertenezca al servidor antes de mencionarlo. Este mapa fijo no caduca y prevalece sobre los comentarios y la caché. Un JSON roto o un ID inválido hace fallar el aviso con un error claro.

Para los revisores ausentes del mapa, el emisor consulta la relación cifrada de 48 horas y luego busca una coincidencia exacta y única entre el login de GitHub y el nombre de usuario de Discord, sin distinguir mayúsculas. Si los nombres son distintos, el autor de la PR o un miembro autorizado puede escribir `/discord-map LOGIN_GITHUB ID_DISCORD` en un comentario de la PR, sustituyendo ambos valores por el login y el ID reales. El ID se obtiene desde Discord con el modo desarrollador y «Copiar ID de usuario». El emisor valida la autoría del comentario, que el login sea un revisor solicitado y que el ID pertenezca al servidor. El comentario es visible para quien pueda leer la PR y deja de utilizarse a las 48 horas, aunque permanece en su historial. No contiene tokens ni claves. Confirmar la relación es opcional: la PR y el aviso continúan sin esa mención.

## Log de menciones fallidas

Cuando un revisor se queda sin mención, el log del job registra una línea de advertencia por cada caso, tras resolver a los revisores y antes de publicar:

```text
PR #N: no Discord mention for <motivo>
```

El motivo es uno de estos tres:

- `<login>: confirmation is not a unique guild member`: la relación confirmada con `/discord-map` no corresponde a un único miembro del servidor.
- `<login>: no unique exact match`: el login no está en el mapa fijo ni en la caché, y la búsqueda no devuelve un único miembro con ese nombre de usuario.
- `multiple reviewers resolve to the same Discord user`: varios revisores apuntan al mismo usuario de Discord. Este motivo no lleva login.

La línea solo contiene el número de PR, el login de GitHub y el motivo: no incluye IDs de Discord, el contenido de `DISCORD_USER_MAP` ni tokens. Se escribe también cuando la ejecución termina en `already-notified`, y un motivo no hace fallar el job. Sin motivos no se escribe esta línea.

## Dos formas de llamar a la acción

Este repositorio publica desde el workflow `PR: check rules` cuando su job termina en verde, y desde `Discord: capture confirmation` para `/discord-map`. El emisor `workflow_run` vive en la rama predeterminada `staging`. En ese modo se pasa `trigger-run-id`; la acción descarga únicamente el número de PR, comprueba la ejecución y vuelve a consultar la PR antes de acceder a Discord. Una PR cerrada, en borrador, con otra base, sin el mínimo de revisores o sin el check `required-check` en verde sobre el SHA actual se omite sin fallar el emisor. Si falta el artefacto, tampoco publica. Este repositorio pasa `minimum-reviewers: 1` y `required-check: check-rules`.

En un repositorio cuya rama predeterminada sea `main`, como aTempo, un workflow de `main` puede usar `pull_request_target` para PR dirigidas a `staging` e `issue_comment` para `/discord-map`. En este modo pasa `pr-number` y `trusted-branch: main`, sin `trigger-run-id`. La acción comprueba el tipo de evento, el repositorio, la rama predeterminada, el número y la base de la PR consultada en GitHub. El workflow privilegiado **no descarga ni ejecuta código de la PR**: invoca solo la acción fijada a un SHA completo del paquete. Así el entorno protegido puede seguir limitado a `main` y basta con incorporar ese workflow a la rama predeterminada.

## Avisos de este repositorio

El job `check-rules` de `.github/workflows/pr-check-rules.yml`, si la base es `staging` y la comprobación ha pasado, sube solo el número de PR. No corre en un draft. `.github/workflows/discord-pr-confirmation-trigger.yml` hace lo mismo con un comentario `/discord-map`. Ninguno de esos pasos recibe el token de Discord. El emisor `.github/workflows/discord-pr-publish.yml` vive en `staging`, la rama predeterminada, y usa la acción local del commit confiable de esa rama. Si el job `check-rules` no acabó en `success`, el emisor no llama a la acción. Una PR creada manualmente sigue el mismo camino cuando sale de draft, tiene al menos un revisor pedido y `check-rules` pasa.

El primer aviso sale una vez por SHA. Si después hay una revisión `CHANGES_REQUESTED` y un commit nuevo vuelve a pasar `check-rules`, el emisor publica otra vez el aviso, marcado como actualización tras cambios pedidos. Un push sin un pedido de cambios nuevo no repite el mensaje.

El administrador configura en el entorno protegido `discord-pr-notifications`, limitado a `staging`, los secretos `DISCORD_BOT_TOKEN` y `DISCORD_CACHE_KEY` y las variables `DISCORD_GUILD_ID` y `DISCORD_GIT_CHANNEL_ID`. Puede añadir `DISCORD_USER_MAP` cuando quiera asociar nombres distintos de forma permanente. La clave debe ser de 32 bytes codificados en base64. El bot necesita permiso para buscar miembros y publicar en el canal. Tras fusionar los workflows en `staging`, se comprueba con una PR real que el aviso aparece una sola vez aunque se repita la ejecución.

El emisor descarga el artefacto de la ejecución completada, vuelve a consultar la PR en GitHub y verifica repositorio, rama, estado, ejecución, el check requerido y los revisores antes de usar los secretos. La acción cifra las relaciones con AES-256-GCM, guarda cada entrada durante 48 horas en artefactos cifrados y registra por separado el anuncio inicial, el SHA avisado, los revisores mostrados y los ya mencionados. Así evita duplicados incluso cuando el primer aviso no lleva menciones. El grupo de concurrencia serializa el acceso a la caché. Discord permite hasta 100 menciones explícitas por mensaje; si el contenido supera los 2000 caracteres, la acción falla sin publicar.

La acción necesita `actions: read`, `contents: read`, `issues: read` y `pull-requests: write` en el token de GitHub. El permiso de escritura sobre PR permite guardar el ledger cifrado como comentario de la PR; `issues: write` con `pull-requests: read` produjo HTTP 403 en una [reproducción de GitHub](https://github.com/github/rest-api-description/issues/6994). La caché y el registro se leen desde el repositorio esperado; los IDs y secretos se pasan por inputs y no forman parte del paquete.
