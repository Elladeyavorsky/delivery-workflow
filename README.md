# delivery-workflow

Paquete [APM](https://github.com/microsoft/apm) para **Claude Code, Cursor y Codex** que lleva una tarea de GitHub desde la idea hasta la revisión, sin salir del chat del agente.

## Qué hace

1. **Piensa la tarea contigo** con preguntas, cada una con su respuesta recomendada.
2. **La deja escrita en GitHub:** issue con etiqueta, rama, commit `chore: open #N` y pull request en draft.
3. **Escribe la spec, el plan y las tasks** en la propia issue.
4. **La implementa en hasta nueve rondas** de código, tests y revisión de la documentación. Cada ronda deja un comentario en la issue.
5. **La cierra** con el commit final, el push y la petición de revisión.
6. **Si la revisión pide cambios**, escribe spec, plan y tasks en un comentario de la misma issue y repite el ciclo.

Se para cuando falta un dato necesario para la spec o para identificar a los revisores, si aparece un secreto o si falla la novena ronda.

Cada proyecto puede añadir una [revisión automática de PR](#revisión-automática-de-pr) que comenta cada PR al salir de draft o al abrirse ya lista.

## Avisos opcionales de PR en Discord

Un proyecto puede activar los [workflows de aviso](docs/DISCORD-PR-NOTIFICATIONS.md) para sus PR hacia `staging`. APM no los instala y los agentes no intervienen. Cuando la PR tiene al menos dos revisores solicitados, el bot la publica en Discord aunque no conozca sus cuentas: muestra los logins de GitHub y menciona solo a quienes pueda verificar.

Si falta una mención, el autor de la PR o un miembro autorizado del repositorio puede escribir **en un comentario de esa PR**:

```text
/discord-map LOGIN_GITHUB ID_DISCORD
```

Sustituye `LOGIN_GITHUB` por el login de un revisor solicitado y `ID_DISCORD` por su ID numérico. Para copiarlo, activa el modo desarrollador de Discord, abre el menú de esa persona y elige «Copiar ID de usuario». El workflow comprueba que el login sea revisor y que el ID pertenezca al servidor; después guarda la relación cifrada durante 48 horas y envía una mención adicional solo a esa persona. El comentario es visible en la PR: escribe únicamente el login y el ID, nunca el token del bot.

El comentario es opcional. Si alguien no está en Discord o nadie confirma la relación, la revisión en GitHub y el aviso de la PR continúan sin esa mención.

## Revisión automática de PR

Un proyecto puede activar una primera revisión de cada pull request. Cuando la PR sale de draft o se abre ya lista, el workflow `review.yml` lanza `anthropics/claude-code-action` con la skill `review-pr`. El bot `claude[bot]` publica un comentario en español que empieza por `## Revisión automática`: comprueba que la PR hace lo que pide la issue enlazada con `Closes #N`, busca fallos en el código y lo compara con lo que ya hay en el proyecto. Solo comenta: no aprueba ni pide cambios. Cada salida de draft deja un comentario nuevo.

Puesta en marcha, una vez por proyecto:

1. Copia la plantilla `review.yml` de la skill en `.github/workflows/` y haz commit. Después de `apm install` está en `.claude/skills/review-pr/assets/review.yml` (Claude Code) o en `.agents/skills/review-pr/assets/review.yml` (Cursor y Codex).
2. Añade el secreto `ANTHROPIC_API_KEY` al repositorio, en *Settings › Secrets and variables › Actions*, con tu clave de Anthropic.
3. Instala la [Claude GitHub App](https://github.com/apps/claude) en el repositorio.

Las PR que llegan desde un fork no se revisan: el job aparece como saltado y la ejecución no falla. El workflow usa `pull_request` y no `pull_request_target`, así que una ejecución con código ajeno nunca recibe los secretos.

El workflow descarga la skill de la rama `main` de este repositorio, que solo cambia en cada versión. Para usar la misma versión que tienes instalada, cambia ese `ref: main` por la etiqueta, por ejemplo `ref: v0.5.0`. `anthropics/claude-code-action` va fijada a `@v1`; si prefieres un SHA, sustitúyela por el de la versión que quieras.

## Requisitos

- Un proyecto con git y un remoto `origin` en GitHub en el que puedas escribir.
- [GitHub CLI](https://cli.github.com) (`gh`), Node 20 o superior y APM. `gh` no necesita sesión.
- **Un `.env` en la raíz del proyecto con tu token de GitHub**, y `.env` en `.gitignore`. Sin eso, el flujo no arranca.

## El token de GitHub

El flujo de entrega que ejecutan los agentes en GitHub (issues, pull requests, etiquetas, revisiones) usa el token del `.env`; la sesión de `gh` y las variables de tu terminal no entran en el flujo. El aviso de Discord usa el `github.token` del workflow y los secretos del entorno protegido. Por eso no hace falta abrir tu herramienta desde la terminal: basta con que encuentre `gh` y `node`, y `/check-status` lo comprueba.

1. Crea un token **clásico** con el permiso `repo` en <https://github.com/settings/tokens/new?scopes=repo>. Que sea de tu cuenta: todo lo que haga el flujo aparecerá a tu nombre. Los tokens *fine-grained* no sirven en repositorios personales de otra persona.
2. En la raíz del proyecto, crea o abre el fichero `.env` con tu editor y añade esta línea, con tu token:

   ```
   GITHUB_TOKEN=ghp_tu_token
   ```

3. Comprueba que `.env` está en `.gitignore`. Si no, añádelo: `echo .env >> .gitignore`.

Cada persona tiene su propio `.env` con su propio token. El `.env` se queda en tu equipo: no lo subas al repositorio. El push sigue usando tus credenciales de git.

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

5. (Opcional) Elige el modelo de cada agente con `/configure-models`, según se describe en [Modelos de los agentes](#modelos-de-los-agentes). Repítelo después de cada `apm install` o `apm update`.

6. (Opcional) Configura Context7 con `/setup-context7`, según se describe en [Context7](#context7).

## Context7

[Context7](https://context7.com) da a los agentes la documentación actual y de la versión concreta de cada librería, para que no escriban código para versiones antiguas.

`/setup-context7` lee las dependencias de tu proyecto (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`), en la raíz y en cualquier subcarpeta. En un repositorio git los busca con `git ls-files`, así que respeta `.gitignore` (sin `node_modules` ni `dist`) y no tiene límite de profundidad; sin git recorre hasta 3 niveles. Propone todas salvo los tipos y las utilidades de build, y pide confirmación una sola vez: quita las que no quieras. Después escribe el MCP en `.cursor/mcp.json`, `.mcp.json` o `.codex/config.toml`, según tus herramientas, sin tocar otros MCP, y deja una regla con tus librerías en `AGENTS.md` o `CLAUDE.md`.

**La clave es opcional.** Context7 funciona sin ella, con un límite menor de peticiones. Si quieres más, crea una clave gratis en context7.com/dashboard y añádela a tu `.env`, junto al token de GitHub:

```dotenv
CONTEXT7_API_KEY=tu-clave
```

Los editores no leen el `.env` solos. Antes de abrir el editor, cárgalo en la terminal y ábrelo desde ahí:

```bash
set -a; source .env; set +a
cursor .      # o claude, o codex
```

## Modelos de los agentes

Cada agente puede ejecutarse con un modelo acorde a su tarea (uno de mayor capacidad para el que redacta la especificación y uno ligero para el que lanza un script), y cada persona dispone de una suscripción distinta. Por ello el modelo no se incluye en el paquete. Es un paso opcional: tras `apm install`, ejecuta `/configure-models` en el chat. La skill detecta los modelos disponibles en tu cuenta, propone uno por agente indicando el motivo y solicita confirmación una sola vez para aceptarlos o cambiar alguno.

Compatible con **Cursor, Claude Code y Codex**. Qué tener en cuenta:

- `apm install` y `apm update` eliminan la línea `model` de los agentes: vuelve a ejecutar `/configure-models`, que conserva tus elecciones anteriores. `check-status` lo señala con `Modelos: desincronizado`.
- La línea `model` es personal: no la incluyas en los commits.

Funcionamiento, cambio de modelo y verificación en cada herramienta: [docs/MODELS.md](docs/MODELS.md).

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
| «La PR pide cambios» | Spec, plan y tasks en un comentario de la misma issue, y se repite el ciclo. |

**Tipos de tarea:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore` y `knowledge`. Las ramas se llaman `número-tipo-descripcion`.

**Rama base:** `GIT_WORKFLOW_BASE` si está definida, si no `staging` si existe, y si no la rama por defecto.

La prosa de issues, spec, pull requests y documentación del ciclo sigue la skill `say-it-straight` (español declarativo); los commits siguen en inglés con `commit-changes`.

## Permisos

La primera vez que el flujo lanza `bash`, `node`, `git` o `gh`, la herramienta pide permiso. En Claude Code puedes aprobarlos de una vez en `.claude/settings.local.json`, solo en proyectos en los que confíes:

```json
{ "permissions": { "allow": ["Bash(bash:*)", "Bash(node:*)", "Bash(git:*)", "Bash(gh:*)"] } }
```

## Actualizar y desinstalar

- **Actualizar:** cambia la versión en `apm.yml` (por ejemplo, `#v0.2.0`), lanza `apm install` y haz commit.
- **Desinstalar:** `apm uninstall venturars/delivery-workflow`. El `.env` es tuyo: bórralo o déjalo.

## Trabajar en este repositorio

Para cambiar delivery-workflow, instala antes el propio paquete con APM. Así tienes los agentes y las skills del flujo (`/delivery-workflow`, `/check-status`, `say-it-straight`…) y trabajas en este repositorio con la misma herramienta que lo usa.

1. Clona el repositorio y entra en su raíz.
2. Instala el paquete para tu herramienta (`claude`, `cursor`, `codex` o varias separadas por comas):

   ```bash
   apm install --target claude
   ```

3. Crea el `.env` con tu token, como explica [El token de GitHub](#el-token-de-github).
4. Abre tu herramienta en la raíz y llama a `/delivery-workflow` (en Codex, `$delivery-workflow`) para abrir la issue, la rama y la pull request de tu cambio.

`apm install` genera `apm_modules/`, `apm.lock.yaml` y los directorios de tu herramienta. No los edites a mano. Las normas del cambio (issues, ramas, commits y pull requests) están en [CONTRIBUTING.md](CONTRIBUTING.md).

## Más información

- [CONTRIBUTING.md](CONTRIBUTING.md): cómo proponer un cambio: issues, ramas, commits y pull requests.
- [CHANGES.md](CHANGES.md): de dónde sale el paquete y qué cambia respecto al original.
- [docs/MODELS.md](docs/MODELS.md): criterio de elección del modelo de cada agente y motivo por el que no se versiona.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md): tests, prueba en un repositorio desechable y cómo publicar una versión.
- [GLOSSARY.md](GLOSSARY.md): vocabulario del flujo.
