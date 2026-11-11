# delivery-workflow

Paquete [APM](https://github.com/microsoft/apm) para **Claude Code, Cursor y Codex** que lleva una tarea de GitHub desde la idea hasta la revisión, sin salir del chat del agente.

## Qué hace

1. **Piensa la tarea contigo** con preguntas, cada una con su respuesta recomendada.
2. **La deja escrita en GitHub:** issue con etiqueta, rama, commit `chore: open #N` y pull request en draft.
3. **Escribe la spec, el plan y las tasks** en la propia issue.
4. **La implementa en hasta nueve rondas** de código, tests y revisión de la documentación. Cada ronda deja un comentario en la issue.
5. **La cierra** con el commit final, el push y la petición de revisión.

Solo se para si a la spec le falta un dato, si aparece un secreto o si falla la novena ronda.

## Requisitos

- Un proyecto con git y un remoto `origin` en GitHub en el que puedas escribir.
- [GitHub CLI](https://cli.github.com) (`gh`), Node 20 o superior y APM. `gh` no necesita sesión.
- **Un `.env` en la raíz del proyecto con tu token de GitHub**, y `.env` en `.gitignore`. Sin eso, el flujo no arranca.

## El token de GitHub

Todo lo que el paquete hace en GitHub (issues, pull requests, etiquetas, revisiones) lo hace con el token del `.env`, nunca con la sesión de `gh` ni con variables de tu terminal. Por eso no hace falta abrir tu herramienta desde la terminal: basta con que encuentre `gh` y `node`, y `/check-status` lo comprueba.

1. Crea un token **clásico** con el permiso `repo` en <https://github.com/settings/tokens/new?scopes=repo>. Que sea de tu cuenta: todo lo que haga el flujo aparecerá a tu nombre. Los tokens *fine-grained* no sirven en repositorios personales de otra persona.
2. En la raíz del proyecto, crea o abre el fichero `.env` con tu editor y añade esta línea, con tu token:

   ```
   GITHUB_TOKEN=ghp_tu_token
   ```

3. Comprueba que `.env` está en `.gitignore`. Si no, añádelo: `echo .env >> .gitignore`.

Cada persona tiene su propio `.env` con su propio token. El `.env` no se sube nunca. El push sigue usando tus credenciales de git.

## Instalación en macOS y Linux

1. Prepara el equipo, una sola vez:

   ```bash
   brew install gh node apm          # sin Homebrew: curl -sSL https://aka.ms/apm-unix | sh
   ```

2. Instala el paquete desde la raíz del proyecto. En `--target` pon tu herramienta: `claude`, `cursor`, `codex` o varias separadas por comas.

   ```bash
   apm install venturars/delivery-workflow#v0.1.0 --target claude
   ```

   Mientras no exista `v0.1.0`, usa `#staging`.

3. Haz commit de `apm.yml` y `apm.lock.yaml`.

4. Crea el `.env` con tu token, como explica [El token de GitHub](#el-token-de-github).

5. Elige el modelo de cada agente con `/configure-models`, como explica [Modelos de los agentes](#modelos-de-los-agentes). Repítelo después de cada `apm install` o `apm update`.

## Modelos de los agentes

Cada agente puede correr con un modelo que encaje con su trabajo (uno potente para el que escribe la spec, uno ligero para el que lanza un script), y cada colega tiene otra suscripción. Por eso el modelo no viene en el paquete: tras `apm install`, escribe `/configure-models` en el chat. Detecta los modelos de tu cuenta, propone uno por agente con el motivo y te pregunta una vez si los aceptas o quieres cambiar alguno. Con `--yes` acepta sin preguntar. Si no lo haces, los agentes usan el modelo de tu chat y todo funciona.

Por ahora solo con **Cursor**. Qué necesitas saber:

- `apm install` y `apm update` borran la línea `model` de los agentes: vuelve a ejecutar `/configure-models` (recuerda tus elecciones). `check-status` avisa con `Modelos: desincronizado`.
- La línea `model` es tuya y no debe llegar a git. `/configure-models` ofrece añadir al `.gitignore` los 8 archivos de agentes del paquete, uno a uno.
- **Si tu proyecto ya sube esos archivos** (`.cursor/agents/…`), `.gitignore` no basta: ejecuta una vez el `git rm --cached` que te escribe `/configure-models`, y haz commit. Nunca lo ejecuta él.

Cómo funciona, cómo cambiar un modelo y qué falla en Cursor: [docs/MODELOS.md](docs/MODELOS.md).

## Instalación en Windows

Los scripts del paquete son de `bash`, así que en Windows hacen falta una terminal y un entorno de tipo Unix. Elige una opción.

### Opción A: WSL (recomendada, vale para las tres herramientas)

1. En PowerShell como administrador: `wsl --install`, y reinicia.
2. Abre **Ubuntu**, clona el proyecto dentro de WSL (por ejemplo, en `~/proyectos`) y sigue [Instalación en macOS y Linux](#instalación-en-macos-y-linux). Sin Homebrew:

   ```bash
   sudo apt update && sudo apt install -y gh
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   source ~/.bashrc && nvm install 22      # el Node de apt puede ser anterior a 20
   curl -sSL https://aka.ms/apm-unix | sh
   ```

3. Abre la herramienta desde la terminal de Ubuntu: `claude`, `codex` o `cursor .` (Cursor abre el proyecto conectado a WSL). El `.env` va en la raíz del proyecto, dentro de WSL.

### Opción B: Git Bash (solo Claude Code)

1. Instala [Git for Windows](https://git-scm.com/download/win), que trae Git Bash. Claude Code lo usa para lanzar comandos.
2. En PowerShell:

   ```powershell
   winget install --id GitHub.cli
   winget install --id OpenJS.NodeJS.LTS
   winget install --id Microsoft.APM --exact --source winget
   ```

3. Abre **Git Bash** y sigue los pasos de [Instalación en macOS y Linux](#instalación-en-macos-y-linux) desde el paso 2.

## Uso

Llama al orquestador con `/delivery-workflow` (en Codex, `$delivery-workflow`) y pide lo que quieras con tus palabras:

| Pide | Qué pasa |
|---|---|
| «Ayúdame a pensar cómo contar usuarios por género» | Una entrevista y un resumen. |
| «Crea la issue y hazla: …» | Todo el flujo, de la issue al commit final. |
| «Crea la issue, solo git: …» | Hasta la pull request en draft. El código lo escribes tú. |
| «Guarda `src/users.js` con feat: count users by gender» | Commit de esos ficheros y push. |
| «Que la revisen Ana y Luis» | Pide la revisión y saca la pull request de draft. |

**Tipos de tarea:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore` y `knowledge`. Las ramas se llaman `número-tipo-descripcion`.

**Rama base:** `GIT_WORKFLOW_BASE` si está definida, si no `staging` si existe, y si no la rama por defecto.

## Permisos

La primera vez que el flujo lanza `bash`, `node`, `git` o `gh`, la herramienta pide permiso. En Claude Code puedes aprobarlos de una vez en `.claude/settings.local.json`, solo en proyectos en los que confíes:

```json
{ "permissions": { "allow": ["Bash(bash:*)", "Bash(node:*)", "Bash(git:*)", "Bash(gh:*)"] } }
```

## Actualizar y desinstalar

- **Actualizar:** cambia la versión en `apm.yml` (por ejemplo, `#v0.2.0`), lanza `apm install` y haz commit.
- **Desinstalar:** `apm uninstall venturars/delivery-workflow`. El `.env` es tuyo: bórralo o déjalo.

## Más información

- [CAMBIOS.md](CAMBIOS.md): de dónde sale el paquete y qué cambia respecto al original.
- [docs/MODELOS.md](docs/MODELOS.md): cómo se elige el modelo de cada agente y por qué no se sube a git.
- [docs/MANTENIMIENTO.md](docs/MANTENIMIENTO.md): tests, prueba en un repositorio desechable y cómo publicar una versión.
- [docs/adr/](docs/adr/) y [GLOSSARY.md](GLOSSARY.md): decisiones de diseño y vocabulario.
