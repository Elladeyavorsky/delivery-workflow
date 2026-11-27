# delivery-workflow

Paquete [APM](https://github.com/microsoft/apm) para agentes de IA. Lleva una tarea desde la idea hasta la revisión en el forge de tu proyecto, sin salir del chat del agente.

## Qué hace

1. **Piensa la tarea contigo** con preguntas, cada una con su respuesta recomendada.
2. **La deja escrita en el forge:** issue con etiqueta, rama, commit `chore: open #N` y pull request en draft.
3. **Escribe la spec, el plan y las tasks** en la propia issue.
4. **La implementa en hasta nueve rondas** de código, tests y revisión de la documentación. Cada ronda deja un comentario en la issue.
5. **La cierra** con el commit final, el push y la petición de revisión.
6. **Si la revisión pide cambios**, escribe spec, plan y tasks en un comentario de la misma issue y repite el ciclo.

Se para cuando falta un dato necesario para la spec o para identificar a los revisores, si aparece un secreto o si falla la novena ronda.

## Requisitos

- Un proyecto con git y un remoto `origin` en un forge compatible, GitHub o [GitLab](docs/GITLAB.md), en el que puedas escribir.
- APM y Node 24 o superior. En GitHub, además, [GitHub CLI](https://cli.github.com) (`gh`), que no necesita sesión.
- Uno de estos agentes: opencode (1.x o 2.x), Claude Code, Cursor o Codex.
- Un `.env` en la raíz del proyecto con el token de tu forge ([GitHub](#el-token-de-github) o [GitLab](docs/GITLAB.md#token-y-forge)). Sin eso, el flujo no arranca.

## Instalación

### Preparar el equipo

Una sola vez. Elige tu sistema.

**macOS y Linux:**

```bash
brew install gh node apm          # sin Homebrew: curl -sSL https://aka.ms/apm-unix | sh
```

**Windows:** los scripts del paquete son de `bash`, así que hace falta un entorno de tipo Unix.

- **WSL (recomendada, vale para todos los agentes).** En PowerShell como administrador, `wsl --install`, y reinicia. Abre **Ubuntu**, clona el proyecto dentro de WSL (por ejemplo, en `~/proyectos`) e instala las herramientas. Después sigue desde [Instalar el paquete](#instalar-el-paquete) y abre tu agente desde la terminal de Ubuntu (por ejemplo, con `opencode`; con `cursor .`, Cursor abre el proyecto conectado a WSL). El `.env` va en la raíz del proyecto, dentro de WSL.

  ```bash
  sudo apt update && sudo apt install -y gh
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  source ~/.bashrc && nvm install 24      # el Node de apt puede ser demasiado antiguo
  curl -sSL https://aka.ms/apm-unix | sh
  ```

- **Git Bash (para agentes que lanzan sus comandos con él).** Instala [Git for Windows](https://git-scm.com/download/win), que trae Git Bash. Instala en PowerShell las herramientas. Después abre **Git Bash** y sigue desde [Instalar el paquete](#instalar-el-paquete).

  ```powershell
  winget install --id GitHub.cli
  winget install --id OpenJS.NodeJS.LTS     # comprueba con `node -v` que es 24 o superior
  winget install --id Microsoft.APM --exact --source winget
  ```

### Instalar el paquete

Desde la raíz del proyecto en el que vas a usar el flujo. Para cambiar delivery-workflow, sigue [Trabajar en este repositorio](CONTRIBUTING.md#trabajar-en-este-repositorio). En `--target` pon tu agente: `opencode`, `claude`, `cursor`, `codex` o varios separados por comas.

```bash
apm install venturars/delivery-workflow --target opencode
```

Sin etiqueta, APM instala la rama `staging`, que puede llevar cambios sin publicar. Para una versión publicada, añade `#` y la etiqueta de la [última release](https://github.com/venturars/delivery-workflow/releases/latest) al nombre del paquete.

Haz commit de `apm.yml` y `apm.lock.yaml`. Las skills quedan en la carpeta que APM crea para tu agente. Con opencode, las skills van en `.agents/skills/`, los agentes en `.opencode/agents/` y APM escribe `opencode.json`.

**Con opencode**, ejecuta `/configure-models` antes de usar el flujo y después de cada `apm install` o `apm update`: quita el campo `skills:` de los agentes, que un proveedor `openai-compatible` puede rechazar.

### El fichero `.env`

El token de tu forge va en el fichero `.env`, en la raíz del proyecto. Añádelo a `.gitignore` (`echo .env >> .gitignore`): sin eso, el flujo no usa el token. El `.env` se queda en tu equipo: no lo subas al repositorio. El push sigue usando tus credenciales de git. [`.env.example`](.env.example) trae todas las variables que el paquete lee de ese fichero.

### El token de GitHub

Los agentes usan el token del `.env` para todo lo que hacen en GitHub (issues, pull requests, etiquetas, revisiones). La sesión de `gh` y las variables de tu terminal no entran en el flujo, así que no hace falta abrir tu herramienta desde la terminal: basta con que encuentre `gh` y `node`, y `/check-status` lo comprueba.

1. Crea un token **clásico** con el permiso `repo` en <https://github.com/settings/tokens/new?scopes=repo>. Que sea de tu cuenta: todo lo que haga el flujo aparecerá a tu nombre. Los tokens *fine-grained* no sirven en repositorios personales de otra persona.
2. Añade al `.env` esta línea, con tu token:

   ```
   GITHUB_TOKEN=ghp_tu_token
   ```

### GitLab

Para usar el flujo con GitLab, sigue [docs/GITLAB.md](docs/GITLAB.md): requisitos, token y diferencias con GitHub.

## Uso

Con el paquete instalado, el flujo funciona por defecto una vez completada la [Instalación](#instalación): el `.env` y, en opencode, `/configure-models`.

Llama al orquestador con `/delivery-workflow` (en opencode 2.x, pide «usa la skill delivery-workflow»; en Codex, `$delivery-workflow`) y pide lo que quieras con tus palabras. En opencode 2.x las skills no salen en la lista de comandos: pide las demás de la misma forma. En Codex, llámalas todas con `$` en vez de `/`.

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

### Permisos

Según el agente y su configuración, la primera vez que el flujo lanza `bash`, `node`, `git` o `gh` te pide permiso. opencode 1.19.6, con su configuración por defecto, ejecuta los comandos sin preguntar, y el paquete no trae configuración de sandbox para opencode: úsalo solo en proyectos en los que confíes.

En Claude Code puedes aprobarlos de una vez en `.claude/settings.local.json`, solo en proyectos en los que confíes:

```json
{ "permissions": { "allow": ["Bash(bash:*)", "Bash(node:*)", "Bash(git:*)", "Bash(gh:*)"] } }
```

## Recomendado

Tras instalar, estos pasos mejoran el resultado.

- **Modelos de los agentes:** `/configure-models` elige el modelo de cada agente según tu suscripción, para no usar uno que no te conviene. `apm install` y `apm update` borran la línea `model` de los agentes: repite el comando después. Ver [docs/MODELS.md](docs/MODELS.md).
- **Documentación de las dependencias:** para que los agentes lean la documentación de la versión que usas y no escriban código para versiones antiguas. Elige uno de estos dos canales, porque solo puede haber uno activo ([comparación de los canales](docs/DEPENDENCY-DOCS.md#canales-de-documentación)):
  - **RAG local (recomendado):** `/setup-docs-rag`. Tus consultas no salen de tu ordenador. Necesita Docker, Ollama y `uv` (en Windows con opencode, también `bash`: WSL o Git Bash). Ver [docs/RAG-LOCAL.md](docs/RAG-LOCAL.md).
  - **Context7:** `/setup-context7`. No pide instalar nada, pero envía el nombre de la librería y tu pregunta a un servicio externo, Upstash. Ver [docs/CONTEXT7.md](docs/CONTEXT7.md).
- **Docker:** la skill `docker-best-practices`, para que el `Dockerfile` y el `docker-compose.yml` fijen versiones y se comprueben antes de la pull request. Ver [docs/DOCKER.md](docs/DOCKER.md).
- **Compliance:** `/setup-compliance`, para tener los documentos del AI Act y el RGPD del proyecto. Es orientativo: no certifica cumplimiento ni es asesoramiento jurídico. Ver [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

En opencode 2.x, reinicia opencode después de `/setup-docs-rag` o `/setup-context7` para que cargue el MCP.

**Opcional:** los avisos de PR en Discord solo funcionan en GitHub y están apagados por defecto. `/setup-discord-notifications` los activa y necesita un token con permiso de administración sobre el repositorio. Ver [docs/DISCORD-PR-NOTIFICATIONS.md](docs/DISCORD-PR-NOTIFICATIONS.md).

## Actualizar y desinstalar

- **Actualizar:** `apm update` y haz commit de `apm.yml` y `apm.lock.yaml`. En opencode, repite además el paso de [Instalar el paquete](#instalar-el-paquete).
- **Desinstalar:** `apm uninstall venturars/delivery-workflow`. El `.env` es tuyo: bórralo o déjalo.

## Más información

- [CONTRIBUTING.md](CONTRIBUTING.md): cómo proponer un cambio y cómo trabajar en este repositorio.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md): cómo se prueba y se publica una versión.
- [CHANGES.md](CHANGES.md): de dónde sale el paquete y qué cambia respecto al original.
- [GLOSSARY.md](GLOSSARY.md): vocabulario del flujo.
- [docs/](docs/): el resto de la documentación.

El paquete tiene licencia Apache 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)).
