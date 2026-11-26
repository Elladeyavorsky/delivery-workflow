# Avisos de revisión de PR en Discord

La acción compuesta de `.github/actions/discord-pr-notifications/` verifica una PR hacia la base configurada y publica una línea separadora, el repositorio, el título, el enlace y los revisores solicitados en GitHub. Cada parte lleva un icono. No incluye el cuerpo de la PR ni ejecuta su código. Publica cuando hay al menos el mínimo de revisores pedidos, aunque ninguno tenga relación conocida con Discord; menciona solo a los verificados y muestra los demás logins como «sin mención de Discord». Si no se pasa `minimum-reviewers`, el mínimo sigue siendo dos. Si una relación se confirma más tarde, envía un aviso adicional solo para esa persona.

## Activación optativa y nombres distintos

Ninguna skill ni agente del paquete consulta Discord o condiciona una solicitud de revisión. Instalar el paquete mediante APM no instala estos workflows: cada repositorio opta por ellos con [`/setup-discord-notifications`](#activar-con-setup-discord-notifications) o, a mano, al añadir sus archivos de `.github/workflows/` y configurar el entorno protegido. `delivery-workflow` los incluye para sus propias PR; aTempo puede activar la misma acción desde un workflow fijado al SHA completo de un commit confiable del paquete.

El administrador puede definir la variable opcional `DISCORD_USER_MAP` del entorno protegido con un objeto JSON como `{"login-github":"ID_DE_DISCORD"}`, sustituyendo el marcador por un ID numérico real. La acción lo recibe mediante el input `user-map`: comprueba el formato de todas las entradas y valida que el ID del revisor pertenezca al servidor antes de mencionarlo. Este mapa fijo no caduca y prevalece sobre los comentarios y la caché. Hacen fallar el aviso un JSON mal formado, un login inválido, un login repetido con distinta capitalización, un ID que no sea un texto de 17 a 20 dígitos y el ID de un revisor pedido que no esté en el servidor. Dos claves idénticas en el JSON no dan error: gana la última.

Para los revisores ausentes del mapa, el emisor consulta la relación cifrada de 48 horas y luego busca una coincidencia exacta y única entre el login de GitHub y el nombre de usuario de Discord, sin distinguir mayúsculas. Si los nombres son distintos, el autor de la PR o alguien que GitHub marca como `OWNER`, `MEMBER` o `COLLABORATOR` puede escribir `/discord-map LOGIN_GITHUB ID_DISCORD` en un comentario de la PR, sin más texto y sustituyendo ambos valores por el login y el ID reales. El ID se obtiene desde Discord con el modo desarrollador y «Copiar ID de usuario». El emisor valida la autoría del comentario, que el login sea un revisor solicitado y que el ID pertenezca al servidor. El comentario es visible para quien pueda leer la PR y deja de utilizarse a las 48 horas de publicarse o editarse, aunque permanece en su historial. No contiene tokens ni claves. Confirmar la relación es opcional: la PR y el aviso continúan sin esa mención.

## Activar con `/setup-discord-notifications`

La skill `setup-discord-notifications` activa los avisos en un proyecto. Sin ella, `apm install` no añade nada de Discord. Los workflows son de GitHub Actions: un remoto que no sea de GitHub queda fuera. Requiere Node 20+, `gh` y un `GITHUB_TOKEN` en el `.env` con permiso de administración sobre el repositorio: el script lanza `gh` con ese token, no con la sesión de `gh`. En Codex, la skill se llama con `$` en vez de `/`.

Discord no permite crear el bot por API: lo creas tú en el Developer Portal y la skill te guía. Antes de pedirte nada comprueba que `.env` está en `.gitignore` y avisa si no. Los pasos son:

1. Crear una aplicación con «New Application» en `https://discord.com/developers/applications`.
2. En la pestaña «Bot», crear el bot y pulsar «Reset Token». Discord muestra el token una sola vez: cópialo a una línea `DISCORD_BOT_TOKEN=…` del `.env`, sin pegarlo en el chat.
3. Dejar desactivados los «Privileged Gateway Intents». La skill no pide activar ninguno, ni el «Server Members Intent».
4. Copiar el «Application ID» y abrir el enlace de invitación que la skill construye con él: `https://discord.com/oauth2/authorize?client_id=ID_APLICACION&scope=bot&permissions=3072`. `permissions=3072` suma «View Channel» (1024) y «Send Messages» (2048); no incluye «Mention Everyone». Elige tu servidor.
5. Activar el modo desarrollador en Discord y copiar el ID del servidor y el del canal de avisos.

Si ya tienes el bot, el token en el `.env` y los dos IDs, la skill salta esta guía. Si el token se copió mal o se perdió, «Reset Token» genera otro y deja de valer el anterior.

La skill muestra el estado del repositorio (`detect`), pregunta la rama base de las PR, el ID del servidor y el del canal, te ofrece `verify` y lanza `apply`. Por defecto la rama base es `staging` si existe en el remoto y, si no, la rama predeterminada. `--minimum-reviewers` fija los revisores mínimos que escribe en el workflow de emisión: 1 por defecto.

### Comprobar el bot con `verify`

`verify` es opcional y de solo lectura: no escribe ficheros ni toca la configuración de GitHub. Llama a `discord.com` con el `DISCORD_BOT_TOKEN` del `.env`, `--guild-id` y `--channel-id`, así que la skill pide tu confirmación antes de lanzarlo. `apply` no depende de él.

Comprueba que el token vale, que el bot está en el servidor y que ve el canal y es de ese servidor. Devuelve `{ ok, checks: { token, servidor, canal } }`. Cada comprobación trae `result` (`correcto`, `fallo` u `omitida`), `reason` y, si Discord respondió, `status` con el código HTTP. Si el token falla, `servidor` y `canal` salen `omitida`. Con alguna comprobación en `fallo` sale con código 6 y la skill explica el motivo; no sigue con `apply` hasta que decidas. Sin `DISCORD_BOT_TOKEN` en el `.env`, o con un ID ausente o no numérico, sale con código 2 sin llamar a la red. Nunca imprime el token.

`verify` no comprueba el permiso de publicar: lo confirma la prueba real del aviso, con una PR fuera de draft y un revisor pedido.

### Qué copia

`apply` escribe estos ficheros en el proyecto, con la rama base, la rama predeterminada, el repositorio y los revisores mínimos ya rellenados:

- `.github/workflows/discord-pr-trigger.yml`, `.github/workflows/discord-pr-confirmation-trigger.yml` y `.github/workflows/discord-pr-publish.yml`.
- Los ficheros de la acción, en `.github/actions/discord-pr-notifications/`.

La primera línea de cada fichero lleva una marca con el hash SHA-256 del resto. `apply` no hace commit, push ni PR: el commit y el merge son tuyos. Los workflows solo actúan cuando están en la rama predeterminada; si la rama base no es la predeterminada, llévalos también a la base.

### Qué crea en GitHub

Con `gh`, `apply` crea el entorno protegido `discord-pr-notifications`, limitado a la rama predeterminada, y fija en él:

- Secretos: `DISCORD_BOT_TOKEN`, que toma del `.env`, y `DISCORD_CACHE_KEY`, una clave aleatoria de 32 bytes en base64 que no se rota si ya existe.
- Variables: `DISCORD_GUILD_ID` y `DISCORD_GIT_CHANNEL_ID`.

Los valores de los secretos van a `gh` por la entrada estándar y no se imprimen. Cuando `DISCORD_BOT_TOKEN` ya está en el entorno, el `.env` puede no traerlo. `--guild-id` y `--channel-id` pueden omitirse si la variable ya existe. Con el token fijado, borra `DISCORD_BOT_TOKEN` del `.env`.

`DISCORD_USER_MAP` es una variable opcional: la skill no pregunta sus valores ni la crea. Después de `apply`, te informa en el chat sobre las menciones. La mención sale sin configurar nada si el nombre de usuario de Discord del revisor coincide con su login de GitHub (coincidencia exacta y única, sin distinguir mayúsculas) y es miembro del servidor. Hace falta mapear cuando los nombres difieren: sin mapa ni `/discord-map`, el aviso sale sin mencionar a esa persona («sin mención de Discord») y no es un fallo. [Activación optativa y nombres distintos](#activación-optativa-y-nombres-distintos) describe las dos formas de mapear, la variable (permanente) y el comentario `/discord-map` (48 horas). Los IDs de Discord no son secretos y pueden pasar por el chat; el token del bot, nunca.

### Actualizar y conservar lo editado

`apply` da un resultado por fichero, entorno, secreto y variable: `creado`, `igual`, `actualizado` o `conservado`. Repetirlo es seguro y termina el trabajo si `gh` falló a mitad: el error lista qué quedó hecho y qué no.

- Un fichero con la marca y el hash intacto se actualiza si la plantilla cambió.
- Un fichero sin marca, o con el hash roto, cuenta como editado: se conserva y `apply` lo avisa.
- Una variable que ya tiene ese valor queda `igual`; si cambia, `actualizado`.

### Quitar los avisos

`reset` quita los ficheros de Discord con la marca y el hash intactos. Los editados o sin marca se conservan con un aviso. El entorno, sus secretos y sus variables solo se borran con `--remove-environment`, y la skill lo lanza solo si lo confirmas. Sin esa opción, `reset` los lista como pendientes. Con `--remove-environment` hace falta `GITHUB_TOKEN` en el `.env`, y si `gh` no responde, no quita nada. `reset` no hace commit.

### Pasos manuales

Si `gh` no responde con el token del proyecto, la skill lo dice y para sin escribir nada. Un `403` significa que el token del `.env` no tiene permiso de administración sobre el repositorio; el mensaje es «El GITHUB_TOKEN del .env no tiene permiso de administración sobre OWNER/REPO (gh respondió 403)». Da ese permiso al token y repite, o sigue estos pasos con una cuenta administradora.

Si el plan de GitHub no admite entornos protegidos, `gh` responde 404 o 403 al crear el entorno. `apply` para con código 5 sin fijar nada y no usa secretos de repositorio: los avisos necesitan el entorno protegido. Pasa el repositorio a un plan que lo admita o no actives los avisos.

1. Copia de la carpeta `assets/` de la skill (`workflows/` y `discord-pr-notifications/`) los tres workflows a `.github/workflows/` y los ficheros de la acción a `.github/actions/discord-pr-notifications/`. Sustituye los marcadores `{{REPOSITORY}}` (`owner/repo`), `{{BASE_BRANCH}}`, `{{DEFAULT_BRANCH}}` y `{{MINIMUM_REVIEWERS}}`. Un fichero copiado sin la marca de la skill cuenta como editado: un `apply` posterior no lo pisa.
2. En Settings, Environments, crea `discord-pr-notifications`. En Deployment branches and tags, elige «Selected branches and tags» y añade la rama predeterminada.
3. En ese entorno, añade los secretos `DISCORD_BOT_TOKEN` y `DISCORD_CACHE_KEY` (por ejemplo, `openssl rand -base64 32`) y las variables `DISCORD_GUILD_ID` y `DISCORD_GIT_CHANNEL_ID`.
4. Haz commit y merge a la rama predeterminada. Si la rama base no es la predeterminada, lleva los workflows también a la base.

### Mantener la copia de `assets/`

La acción de `.apm/skills/setup-discord-notifications/assets/discord-pr-notifications/` es una copia de `.github/actions/discord-pr-notifications/` y debe mantenerse idéntica. Al cambiar una, cambia la otra. Los workflows de este repositorio en `.github/workflows/` no los gestiona la skill y siguen como están.

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

Con `trigger-run-id`, la ejecución tiene que haber terminado en `success`, ser del repositorio esperado y venir de uno de estos disparadores:

- **PR:** evento `pull_request` de un workflow llamado `Discord: capture PR` (el que copia la skill), `PR: check rules` (el de este repositorio) o `review`.
- **Comentario `/discord-map`:** evento `issue_comment` del workflow `Discord: capture confirmation`, con `head_repository` igual al repositorio esperado. Su `head_branch` tiene que ser la rama predeterminada (`repository.default_branch` del evento), aunque la rama base sea otra. Si el evento no trae ese campo como texto no vacío, la ejecución se rechaza.

Cualquier otra ejecución falla con «The completed run does not belong to this repository and trigger.».

En un repositorio cuya rama predeterminada sea `main`, como aTempo, un workflow de `main` puede usar `pull_request_target` para PR dirigidas a `staging` e `issue_comment` para `/discord-map`. En este modo pasa `pr-number` y `trusted-branch: main`, sin `trigger-run-id`. La acción comprueba el tipo de evento, el repositorio, la rama predeterminada, el número y la base de la PR consultada en GitHub. El workflow privilegiado **no descarga ni ejecuta código de la PR**: invoca solo la acción fijada a un SHA completo del paquete. Así el entorno protegido puede seguir limitado a `main` y basta con incorporar ese workflow a la rama predeterminada.

En los dos modos, `base-branch` admite `/` (por ejemplo, `release/1.0`) y se compara como texto con la base de la PR. Los verificadores de los dos modos y el emisor `notify.mjs` fallan con un error de configuración incompleta, sin consultar la PR ni llamar a Discord, si el nombre:

- falta o está vacío;
- tiene un carácter distinto de letras ASCII, dígitos, `_`, `.`, `-` y `/`;
- empieza por `/`, `.` o `-`;
- contiene `..` o `//`;
- acaba en `/`, `.` o `.lock`.

`trusted-branch` no admite `/`.

## Avisos de este repositorio

El job `check-rules` de `.github/workflows/pr-check-rules.yml`, si la base es `staging` y la comprobación ha pasado, sube solo el número de PR. No corre en un draft. `.github/workflows/discord-pr-confirmation-trigger.yml` hace lo mismo con un comentario `/discord-map`. Ninguno de esos pasos recibe el token de Discord. El emisor `.github/workflows/discord-pr-publish.yml` vive en `staging`, la rama predeterminada, y usa la acción local del commit confiable de esa rama. Si el job `check-rules` no acabó en `success`, el emisor no llama a la acción. Una PR creada manualmente sigue el mismo camino cuando sale de draft, tiene al menos un revisor pedido y `check-rules` pasa.

El primer aviso sale una vez por SHA. Si después hay una revisión `CHANGES_REQUESTED` y un commit nuevo vuelve a pasar `check-rules`, el emisor publica otra vez el aviso, marcado como actualización tras cambios pedidos. Un push sin un pedido de cambios nuevo no repite el mensaje.

El administrador configura en el entorno protegido `discord-pr-notifications`, limitado a `staging`, los secretos `DISCORD_BOT_TOKEN` y `DISCORD_CACHE_KEY` y las variables `DISCORD_GUILD_ID` y `DISCORD_GIT_CHANNEL_ID`. Puede añadir `DISCORD_USER_MAP` cuando quiera asociar nombres distintos de forma permanente. La clave debe ser de 32 bytes codificados en base64. El bot de este repositorio necesita permiso para buscar miembros y publicar en el canal. El bot que crea `/setup-discord-notifications` se invita con View Channel y Send Messages (`permissions=3072`); si la búsqueda de miembros exige otro permiso, la prueba manual de `docs/MAINTENANCE.md` lo mostrará. Tras fusionar los workflows en `staging`, se comprueba con una PR real que el aviso aparece una sola vez aunque se repita la ejecución.

El emisor descarga el artefacto de la ejecución completada, vuelve a consultar la PR en GitHub y verifica repositorio, rama, estado, ejecución, el check requerido y los revisores antes de usar los secretos. La acción cifra las relaciones con AES-256-GCM, guarda cada entrada durante 48 horas en artefactos cifrados y registra por separado el anuncio inicial, el SHA avisado, los revisores mostrados y los ya mencionados. Así evita duplicados incluso cuando el primer aviso no lleva menciones. El grupo de concurrencia serializa el acceso a la caché. Discord permite hasta 100 menciones explícitas por mensaje; si el contenido supera los 2000 caracteres, la acción falla sin publicar.

La acción necesita `actions: read`, `contents: read`, `issues: read` y `pull-requests: write` en el token de GitHub. El permiso de escritura sobre PR permite guardar el ledger cifrado como comentario de la PR; `issues: write` con `pull-requests: read` produjo HTTP 403 en una [reproducción de GitHub](https://github.com/github/rest-api-description/issues/6994). La caché y el registro se leen desde el repositorio esperado; los IDs y secretos se pasan por inputs y no forman parte del paquete.
