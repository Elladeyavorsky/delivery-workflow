---
name: setup-discord-notifications
description: "Activa los avisos de PR en Discord en el proyecto, apagados por defecto: copia los workflows y la acción a .github/, crea el entorno protegido discord-pr-notifications y fija sus secretos y variables con gh. Úsala si la persona quiere los avisos; sin ella, apm install no añade nada de Discord."
---

### Herramienta: SETUP_DISCORD_NOTIFICATIONS

- **Descripción**: Úsala para activar los avisos de PR en Discord con la persona: copiar al proyecto los workflows y la acción, crear el entorno protegido y fijar sus secretos y variables. Sin esta skill no se instala ni se configura nada de Discord. Los workflows son de GitHub Actions: otros forges quedan fuera.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/setup-discord-notifications.mjs" ORDEN [OPCIONES]`, desde la raíz del repositorio.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/setup-discord-notifications`. Requiere Node 20+, `gh` y el `GITHUB_TOKEN` del `.env` del proyecto con permiso de administración sobre el repositorio: el script lanza `gh` con ese token, no con la sesión de `gh`.

#### Especificación de Argumentos

1. **Orden** _(Obligatorio)_:
   - `detect`: no escribe nada. Devuelve el repositorio (`owner/repo`), su rama predeterminada, si `gh` responde con el token del proyecto (`gh.available` y, si no, `gh.reason`), los ficheros de Discord de `.github/` con su estado (`ausente`, `igual` o `editado`; `igual` es un fichero con la marca de la skill y el hash intacto; sin marca o con el hash roto es `editado`), si el entorno existe y cuáles de sus secretos y variables existen, y si `DISCORD_BOT_TOKEN` está en el `.env` (`botToken.inEnv`). Nunca devuelve el valor de un secreto. Falla si el remoto no es de GitHub.
   - `apply`: copia al proyecto los workflows y la acción con el repositorio, la rama base y los revisores mínimos del proyecto; crea el entorno `discord-pr-notifications` limitado a la rama predeterminada; y fija `DISCORD_BOT_TOKEN` (del `.env`) y `DISCORD_CACHE_KEY` (generada, no se rota si existe) como secretos, y `DISCORD_GUILD_ID` y `DISCORD_GIT_CHANNEL_ID` como variables. Da un `result` por elemento: `creado`, `igual`, `actualizado` o `conservado`. Sin `--base`, usa `staging` si existe en el remoto y, si no, la rama predeterminada. Para sin escribir ni fijar nada si falta `DISCORD_BOT_TOKEN` (en el `.env` y como secreto), si el plan no admite entornos protegidos o si el token no tiene permiso. Si `gh` falla a mitad, el error lista qué quedó hecho y qué no: repetir `apply` termina el trabajo. No hace commit, push ni PR. Nunca imprime valores de secretos.
   - `reset`: quita los ficheros de Discord que tienen la marca de la skill y el hash intacto; los editados o sin marca se conservan y se avisa. El entorno, los secretos y las variables solo se borran con `--remove-environment`; sin esa opción los lista como pendientes (`pending`). Da un `result` por elemento: `quitado`, `ausente` o `conservado`. Con `--remove-environment` exige `GITHUB_TOKEN` en el `.env` y para antes de quitar nada si `gh` no responde. No hace commit.
2. **`--base RAMA`** _(Opcional)_: la rama base de las PR; se rechaza si tiene caracteres que rompan el YAML.
3. **`--guild-id ID`, `--channel-id ID`** _(Opcional)_: IDs numéricos del servidor y del canal de Discord. Ambos son opcionales en `apply`: si falta uno y su variable (`DISCORD_GUILD_ID` o `DISCORD_GIT_CHANNEL_ID`) ya existe en el entorno, queda `conservado`; si la variable no existe, `apply` sale con un error que nombra la opción y no escribe nada. Al repetir `apply` no hace falta darlos otra vez. La validación numérica solo se aplica a los valores dados.
4. **`--minimum-reviewers N`** _(Opcional)_: revisores mínimos; 1 por defecto.
5. **`--remove-environment`** _(Opcional)_: para `reset`: borra también el entorno, sus secretos y sus variables. Solo con la confirmación de la persona.
6. **`--root RUTA`** _(Opcional)_: raíz del proyecto; por defecto la del repositorio git. Sin valor es un error. `gh` se lanza desde esa raíz, así que resuelve el repositorio de su remoto y no el del directorio actual.

#### Flujo

1. Lanza `detect` y muestra a la persona el estado: repositorio, rama predeterminada, ficheros de Discord (`ausente`, `igual`, `editado`), entorno, secretos y variables. Si `gh.available` es `false`, di `gh.reason` y para: si es un 403, el token del `.env` no tiene permiso de administración sobre el repositorio; da los pasos manuales de `docs/DISCORD-PR-NOTIFICATIONS.md`.
2. Pregunta la rama base de las PR, una sola. Por defecto, `staging` si existe en el remoto y, si no, la rama predeterminada.
3. Pregunta el ID del servidor y el del canal de Discord. Si `detect` muestra que las variables ya existen, la persona puede omitirlos.
   Pregunta también cuántos revisores mínimos exige la PR para avisar (`--minimum-reviewers`; 1 por defecto).
4. Comprueba que `.env` está en `.gitignore` y avisa si no, antes de pedir el token. Pide que la persona añada `DISCORD_BOT_TOKEN=…` a su `.env` sin pegarlo en el chat.
5. Lanza `apply` con `--base`, `--guild-id`, `--channel-id` y `--minimum-reviewers`.
6. Muestra la tabla final con el `result` de cada fichero, del entorno, de los secretos y de las variables, y los avisos. Si `apply` falló a mitad, di qué quedó hecho y propón repetirlo.
7. Aconseja borrar `DISCORD_BOT_TOKEN` del `.env` ahora que está en el secreto del entorno. No lo borres tú.
8. Recuerda que los workflows solo actúan cuando están en la rama predeterminada: el commit y el merge son de la persona, la skill no hace commit, push ni PR.
9. Resume la prueba: abrir una PR fuera de draft, pedir un revisor y comprobar que el aviso aparece en Discord una sola vez.

Para quitar los avisos, lanza `reset`. Si hay entorno, secretos o variables pendientes, ofrece `--remove-environment`, explica que borra el entorno `discord-pr-notifications` con sus secretos y variables, y lánzalo solo si la persona lo confirma.

#### Reglas de Invocación Críticas

- **Tú hablas, el script no**: El script nunca pregunta. Las preguntas las haces tú y le pasas las respuestas como opciones.
- **El token del bot no pasa por el chat**: La persona añade `DISCORD_BOT_TOKEN=…` a su `.env` ella misma. Si `.env` no está en `.gitignore`, avísalo antes de pedírselo. Discord no permite crear el bot por API: el token se crea a mano en el Developer Portal.
- **No preguntes por `DISCORD_USER_MAP`**: queda como opcional en `docs/DISCORD-PR-NOTIFICATIONS.md`.
- **Los ficheros editados se conservan**: Un fichero sin marca o con el hash roto cuenta como editado y no se pisa; dilo.
- **Procesamiento de respuestas**: El script escribe JSON. Si el código de salida no es 0, lee el error y comunícalo. Usa solo lo que devuelve el script.
