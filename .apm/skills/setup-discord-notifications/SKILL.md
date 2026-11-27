---
name: setup-discord-notifications
description: "Activa los avisos de PR en Discord en el proyecto, apagados por defecto: guía la creación del bot en el Developer Portal, copia los workflows y la acción a .github/, crea el entorno protegido discord-pr-notifications y fija sus secretos y variables con gh. Su orden verify consulta la API de Discord (discord.com) y solo se lanza con confirmación. Úsala si la persona quiere los avisos; sin ella, apm install no añade nada de Discord."
---

### Herramienta: SETUP_DISCORD_NOTIFICATIONS

- **Descripción**: Úsala para activar los avisos de PR en Discord con la persona: copiar al proyecto los workflows y la acción, crear el entorno protegido y fijar sus secretos y variables. Sin esta skill no se instala ni se configura nada de Discord. Los workflows son de GitHub Actions: otros forges quedan fuera.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/setup-discord-notifications.mjs" ORDEN [OPCIONES]`, desde la raíz del repositorio.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/setup-discord-notifications`. Requiere Node 24+, `gh` y el `GITHUB_TOKEN` del `.env` del proyecto con permiso de administración sobre el repositorio: el script lanza `gh` con ese token, no con la sesión de `gh`.

#### Especificación de Argumentos

1. **Orden** _(Obligatorio)_:
   - `detect`: no escribe nada. Devuelve el repositorio (`owner/repo`), su rama predeterminada, si `gh` responde con el token del proyecto (`gh.available` y, si no, `gh.reason`), los ficheros de Discord de `.github/` con su estado (`ausente`, `igual` o `editado`; `igual` es un fichero con la marca de la skill y el hash intacto; sin marca o con el hash roto es `editado`), si el entorno existe y cuáles de sus secretos y variables existen, y si `DISCORD_BOT_TOKEN` está en el `.env` (`botToken.inEnv`). Nunca devuelve el valor de un secreto. Falla si el remoto no es de GitHub.
   - `apply`: copia al proyecto los workflows y la acción con el repositorio, la rama base y los revisores mínimos del proyecto; crea el entorno `discord-pr-notifications` limitado a la rama predeterminada; y fija `DISCORD_BOT_TOKEN` (del `.env`) y `DISCORD_CACHE_KEY` (generada, no se rota si existe) como secretos, y `DISCORD_GUILD_ID` y `DISCORD_GIT_CHANNEL_ID` como variables. Da un `result` por elemento: `creado`, `igual`, `actualizado` o `conservado`. Sin `--base`, usa `staging` si existe en el remoto y, si no, la rama predeterminada. Para sin escribir ni fijar nada si falta `DISCORD_BOT_TOKEN` (en el `.env` y como secreto), si el plan no admite entornos protegidos o si el token no tiene permiso. Si `gh` falla a mitad, el error lista qué quedó hecho y qué no: repetir `apply` termina el trabajo. No hace commit, push ni PR. Nunca imprime valores de secretos.
   - `verify`: solo lectura: no escribe ficheros ni toca la configuración de GitHub. Con `DISCORD_BOT_TOKEN` del `.env`, `--guild-id` y `--channel-id` llama a `discord.com` y devuelve `{ ok, checks: { token, servidor, canal } }`. Cada comprobación trae `result` (`correcto`, `fallo` u `omitida`), `reason` y `status` (el código HTTP, si hubo respuesta). Comprueba que el token vale, que el bot está en el servidor y que ve el canal y es de ese servidor. Si falla el token, `servidor` y `canal` salen `omitida`. No comprueba el permiso de publicar: lo cubre la prueba real del aviso. Sale con código 6 si alguna falla. Sin `DISCORD_BOT_TOKEN` en el `.env` o con un ID ausente o no numérico, sale con error (código 2) sin llamar a la red. Nunca imprime el token. Es opcional: `apply` no depende de él.
   - `reset`: quita los ficheros de Discord que tienen la marca de la skill y el hash intacto; los editados o sin marca se conservan y se avisa. El entorno, los secretos y las variables solo se borran con `--remove-environment`; sin esa opción los lista como pendientes (`pending`). Da un `result` por elemento: `quitado`, `ausente` o `conservado`. Con `--remove-environment` exige `GITHUB_TOKEN` en el `.env` y para antes de quitar nada si `gh` no responde. No hace commit.
2. **`--base RAMA`** _(Opcional)_: la rama base de las PR; se rechaza si tiene caracteres que rompan el YAML.
3. **`--guild-id ID`, `--channel-id ID`** _(Opcional en `apply`; obligatorios en `verify`)_: IDs numéricos del servidor y del canal de Discord. Ambos son opcionales en `apply`: si falta uno y su variable (`DISCORD_GUILD_ID` o `DISCORD_GIT_CHANNEL_ID`) ya existe en el entorno, queda `conservado`; si la variable no existe, `apply` sale con un error que nombra la opción y no escribe nada. Al repetir `apply` no hace falta darlos otra vez. La validación numérica solo se aplica a los valores dados.
4. **`--minimum-reviewers N`** _(Opcional)_: revisores mínimos; 1 por defecto.
5. **`--remove-environment`** _(Opcional)_: para `reset`: borra también el entorno, sus secretos y sus variables. Solo con la confirmación de la persona.
6. **`--root RUTA`** _(Opcional)_: raíz del proyecto; por defecto la del repositorio git. Sin valor es un error. `gh` se lanza desde esa raíz, así que resuelve el repositorio de su remoto y no el del directorio actual.

#### Flujo

0. **Guía del bot.** Antes de `detect`, pregunta si la persona ya tiene el bot, su token en el `.env` y los IDs del servidor y del canal. Si los tiene, salta este paso. Si no, antes de pedir nada comprueba que `.env` está en `.gitignore` y avisa si no, y guíala en el chat, paso a paso, esperando su confirmación en cada uno:
   1. Entrar en el Developer Portal de Discord (`https://discord.com/developers/applications`) con su cuenta y crear una aplicación con «New Application».
   2. En la pestaña «Bot», crear el bot y pulsar «Reset Token». Discord muestra el token una sola vez: copiarlo directo a una línea `DISCORD_BOT_TOKEN=…` del `.env`, sin pegarlo en el chat.
   3. Dejar desactivados los «Privileged Gateway Intents». No pidas activar ninguno (ni el de miembros, ni el de contenido de mensajes, ni el de presencia): el bot no los necesita.
   4. Copiar el ID de la aplicación («General Information», «Application ID»). Puede ir por el chat. Con él, construye el enlace de invitación y dáselo: `https://discord.com/oauth2/authorize?client_id=ID_APLICACION&scope=bot&permissions=3072` (sustituye `ID_APLICACION`; `permissions=3072` es «View Channel» y «Send Messages»). La persona lo abre y elige su servidor.
   5. En Discord, activar el modo desarrollador («Ajustes de usuario», «Avanzado») y, con el botón derecho, «Copiar ID del servidor» y «Copiar ID del canal» del canal de avisos. Estos IDs pueden ir por el chat.
   Si el token se copió mal o se perdió, la persona lo regenera con «Reset Token» (el anterior deja de valer) y lo copia de nuevo al `.env`.
1. Lanza `detect` y muestra a la persona el estado: repositorio, rama predeterminada, ficheros de Discord (`ausente`, `igual`, `editado`), entorno, secretos y variables. Si `gh.available` es `false`, di `gh.reason` y para: si es un 403, el token del `.env` no tiene permiso de administración sobre el repositorio; da los pasos manuales de `docs/DISCORD-PR-NOTIFICATIONS.md`.
2. Pregunta la rama base de las PR, una sola. Por defecto, `staging` si existe en el remoto y, si no, la rama predeterminada.
3. Pregunta el ID del servidor y el del canal de Discord, si no los dio ya en el paso 0. Si `detect` muestra que las variables ya existen, la persona puede omitirlos.
   Pregunta también cuántos revisores mínimos exige la PR para avisar (`--minimum-reviewers`; 1 por defecto).
4. Comprueba que `DISCORD_BOT_TOKEN` está en el `.env` (`botToken.inEnv` de `detect`). Si falta, pide que la persona lo añada sin pegarlo en el chat.
5. Ofrece `verify`. Explica que es opcional, de solo lectura y que llama a `discord.com` con el token del `.env`, y pide confirmación a la persona antes de lanzarlo. Si acepta, lanza `verify` con `--guild-id` y `--channel-id` y muestra `checks.token`, `checks.servidor` y `checks.canal`. Si falla alguna, explica el motivo (ver «Motivos de fallo de `verify`») y no sigas con `apply` hasta que la persona decida. Si rechaza, sigue sin él.
6. Lanza `apply` con `--base`, `--guild-id`, `--channel-id` y `--minimum-reviewers`.
7. Muestra la tabla final con el `result` de cada fichero, del entorno, de los secretos y de las variables, y los avisos. Si `apply` falló a mitad, di qué quedó hecho y propón repetirlo.
8. Aconseja borrar `DISCORD_BOT_TOKEN` del `.env` ahora que está en el secreto del entorno. No lo borres tú.
9. Recuerda que los workflows solo actúan cuando están en la rama predeterminada y que, si la rama base no es la predeterminada (`baseBranch` y `defaultBranch` en la salida de `apply`), la persona los lleve también a la base. El commit y el merge son de la persona: la skill no hace commit, push ni PR.
10. Informa en el chat sobre las menciones, sin preguntar los valores de `DISCORD_USER_MAP` ni crear la variable:
    - **Cuándo hace falta mapear:** la mención sale sin configurar nada si el nombre de usuario de Discord del revisor coincide con su login de GitHub (coincidencia exacta y única, sin distinguir mayúsculas) y es miembro del servidor. Si difieren, sin mapa ni `/discord-map` el aviso sale sin mencionarlo («sin mención de Discord») y no es un fallo.
    - **Mapa permanente:** la variable `DISCORD_USER_MAP` del entorno `discord-pr-notifications` (en GitHub, «Settings», «Environments»), con un valor JSON como `{"login-de-github":"ID_DE_DISCORD"}` y cada ID entre comillas. No caduca y prevalece sobre `/discord-map` y la caché. Hacen fallar el aviso un JSON mal formado, un login inválido, un login repetido con distinta capitalización, un ID que no sea un texto de 17 a 20 dígitos y el ID de un revisor pedido que no esté en el servidor. Dos claves idénticas en el JSON no dan error: gana la última.
    - **Comentario en la PR:** `/discord-map LOGIN_GITHUB ID_DISCORD`, sin más texto en el comentario. Cuenta si lo escribe el autor de la PR o alguien que GitHub marca como `OWNER`, `MEMBER` o `COLLABORATOR`, para un revisor pedido y con el ID de un miembro del servidor. Dura 48 horas desde que se publica o se edita y es visible en la PR.
    - **El ID:** sale de Discord con el modo desarrollador y «Copiar ID de usuario». Los IDs no son secretos: van en la variable o en el comentario y pueden pasar por el chat. El token del bot, nunca.
11. Resume la prueba: abrir una PR fuera de draft, pedir un revisor y comprobar que el aviso aparece en Discord una sola vez.

#### Motivos de fallo de `verify`

- **`token` con `fallo` (HTTP 401)**: Discord rechazó el token. Está mal copiado o ya no vale. Pide regenerarlo con «Reset Token» en la pestaña «Bot» (invalida el anterior) y copiarlo de nuevo al `.env` sin pasarlo por el chat. `servidor` y `canal` salen `omitida`.
- **`servidor` con `fallo` (HTTP 403 o 404)**: el bot no está en el servidor, o el ID del servidor es otro. Pide invitar el bot con el enlace del paso 0 y revisar el ID del servidor.
- **`canal` con `fallo` (HTTP 403 o 404)**: el canal no existe o el bot no lo ve. Pide revisar el ID del canal y que el rol del bot tenga «View Channel» en él.
- **`canal` con `fallo` y «pertenece a otro servidor»**: el canal existe pero no es del servidor dado. Pide copiar el ID del canal del servidor correcto.
- **Cualquier comprobación con `fallo` (HTTP 429)**: Discord limita las peticiones. Espera un momento y repite `verify`; no es un token inválido.
- **`fallo` por error de red**: no se pudo contactar con `discord.com` (o el token tiene caracteres no válidos para una cabecera). Revisa la conexión y que el valor de `DISCORD_BOT_TOKEN` no tenga espacios ni comillas; repite.
- **Error de código 2**: falta `DISCORD_BOT_TOKEN` en el `.env`, o falta `--guild-id` o `--channel-id`, o no es numérico. No se llamó a Discord.

`verify` no comprueba el permiso de publicar: si todo sale `correcto`, la prueba real del aviso (paso 11) confirma que el bot puede escribir en el canal.

Para quitar los avisos, lanza `reset`. Si hay entorno, secretos o variables pendientes, ofrece `--remove-environment`, explica que borra el entorno `discord-pr-notifications` con sus secretos y variables, y lánzalo solo si la persona lo confirma.

#### Reglas de Invocación Críticas

- **Tú hablas, el script no**: El script nunca pregunta. Las preguntas las haces tú y le pasas las respuestas como opciones.
- **El token del bot no pasa por el chat**: La persona añade `DISCORD_BOT_TOKEN=…` a su `.env` ella misma. Si `.env` no está en `.gitignore`, avísalo antes de pedírselo. Discord no permite crear el bot por API: lo crea la persona en el Developer Portal y esta skill la guía en el paso 0. Los IDs (aplicación, servidor, canal) sí pueden ir por el chat; el token, nunca.
- **`verify` solo con confirmación**: Llama a `discord.com`. Pide confirmación a la persona antes de lanzarlo. Es opcional: `apply` no depende de él.
- **`DISCORD_USER_MAP` se explica, no se pregunta ni se crea**: tras `apply`, di cuándo hace falta mapear y cómo (paso 10). La variable es opcional y la define la persona.
- **Los ficheros editados se conservan**: Un fichero sin marca o con el hash roto cuenta como editado y no se pisa; dilo.
- **Procesamiento de respuestas**: El script escribe JSON. Si el código de salida no es 0, lee el error y comunícalo. Usa solo lo que devuelve el script.
