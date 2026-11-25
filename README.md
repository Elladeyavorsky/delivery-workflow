# delivery-workflow

Paquete [APM](https://github.com/microsoft/apm) para agentes de IA como opencode, Claude Code, Cursor y Codex. Lleva una tarea de GitHub desde la idea hasta la revisión, sin salir del chat del agente.

## Qué hace

1. **Piensa la tarea contigo** con preguntas, cada una con su respuesta recomendada.
2. **La deja escrita en GitHub:** issue con etiqueta, rama, commit `chore: open #N` y pull request en draft.
3. **Escribe la spec, el plan y las tasks** en la propia issue.
4. **La implementa en hasta nueve rondas** de código, tests y revisión de la documentación. Cada ronda deja un comentario en la issue.
5. **La cierra** con el commit final, el push y la petición de revisión.
6. **Si la revisión pide cambios**, escribe spec, plan y tasks en un comentario de la misma issue y repite el ciclo.

Se para cuando falta un dato necesario para la spec o para identificar a los revisores, si aparece un secreto o si falla la novena ronda.

## Requisitos

- Un proyecto con git y un remoto `origin` en GitHub en el que puedas escribir.
- [GitHub CLI](https://cli.github.com) (`gh`), APM y Node 24 o superior. `gh` no necesita sesión.
- Un `.env` en la raíz del proyecto con tu token de GitHub. Sin eso, el flujo no arranca ([El token de GitHub](#el-token-de-github)).

## Instalación

### Preparar el equipo

Una sola vez. Elige tu sistema.

**macOS y Linux:**

```bash
brew install gh node apm          # sin Homebrew: curl -sSL https://aka.ms/apm-unix | sh
```

**Windows:** los scripts del paquete son de `bash`, así que hace falta un entorno de tipo Unix.

- **WSL (recomendada, vale para todos los agentes).** En PowerShell como administrador, `wsl --install`, y reinicia. Abre **Ubuntu**, clona el proyecto dentro de WSL (por ejemplo, en `~/proyectos`) e instala las herramientas. Después sigue desde [Instalar el paquete](#instalar-el-paquete) y abre tu agente desde la terminal de Ubuntu (`opencode`, `claude`, `codex` o `cursor .`; Cursor abre el proyecto conectado a WSL). El `.env` va en la raíz del proyecto, dentro de WSL.

  ```bash
  sudo apt update && sudo apt install -y gh
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  source ~/.bashrc && nvm install 24      # el Node de apt puede ser demasiado antiguo
  curl -sSL https://aka.ms/apm-unix | sh
  ```

- **Git Bash (para agentes que lanzan sus comandos con él, como Claude Code).** Instala [Git for Windows](https://git-scm.com/download/win), que trae Git Bash. Instala en PowerShell las herramientas. Después abre **Git Bash** y sigue desde [Instalar el paquete](#instalar-el-paquete).

  ```powershell
  winget install --id GitHub.cli
  winget install --id OpenJS.NodeJS.LTS     # comprueba con `node -v` que es 24 o superior
  winget install --id Microsoft.APM --exact --source winget
  ```

### Instalar el paquete

Desde la raíz del proyecto. En `--target` pon tu agente: `opencode`, `claude`, `cursor`, `codex` o varios separados por comas.

```bash
apm install venturars/delivery-workflow --target opencode
```

Haz commit de `apm.yml` y `apm.lock.yaml`. Las skills quedan en la carpeta que APM crea para tu agente.

### El token de GitHub

Los agentes usan el token del `.env` para todo lo que hacen en GitHub (issues, pull requests, etiquetas, revisiones). La sesión de `gh` y las variables de tu terminal no entran en el flujo, así que no hace falta abrir tu herramienta desde la terminal: basta con que encuentre `gh` y `node`, y `/check-status` lo comprueba.

1. Crea un token **clásico** con el permiso `repo` en <https://github.com/settings/tokens/new?scopes=repo>. Que sea de tu cuenta: todo lo que haga el flujo aparecerá a tu nombre. Los tokens *fine-grained* no sirven en repositorios personales de otra persona.
2. En la raíz del proyecto, crea o abre el fichero `.env` y añade esta línea, con tu token:

   ```
   GITHUB_TOKEN=ghp_tu_token
   ```

3. Añade `.env` a `.gitignore`: `echo .env >> .gitignore`.

El `.env` se queda en tu equipo: no lo subas al repositorio. El push sigue usando tus credenciales de git.

## Uso

Todo funciona ya por defecto al instalar el paquete con APM. Llama al orquestador con `/delivery-workflow` (en Codex, `$delivery-workflow`) y pide lo que quieras con tus palabras:

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

La primera vez que el flujo lanza `bash`, `node`, `git` o `gh`, tu agente pide permiso. En Claude Code puedes aprobarlos de una vez en `.claude/settings.local.json`, solo en proyectos en los que confíes:

```json
{ "permissions": { "allow": ["Bash(bash:*)", "Bash(node:*)", "Bash(git:*)", "Bash(gh:*)"] } }
```

## Recomendado

Tras instalar, estos pasos mejoran el resultado. Ninguno es necesario para que el flujo funcione.

- **Modelos de los agentes:** `/configure-models` elige el modelo de cada agente según tu suscripción, para no usar uno que no te conviene. Repite el comando tras `apm install` y `apm update`. Ver [docs/MODELS.md](docs/MODELS.md).
- **Context7:** `/setup-context7`, para que los agentes lean la documentación de la versión que usas y no escriban código para versiones antiguas, sin instalar nada. Ver [docs/CONTEXT7.md](docs/CONTEXT7.md).
- **RAG local:** `/setup-docs-rag`, para lo mismo sin que tus consultas salgan de tu ordenador; necesita Docker, Ollama y `uv`. Ver [docs/RAG-LOCAL.md](docs/RAG-LOCAL.md).
- **Docker:** la skill `docker-best-practices`, para que el `Dockerfile` y el `docker-compose.yml` fijen versiones y se comprueben antes de la pull request. Ver [docs/DOCKER.md](docs/DOCKER.md).
- **Compliance:** `/setup-compliance`, para tener los documentos del AI Act y el RGPD del proyecto. Ver [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

**Opcional:** los avisos de PR en Discord están apagados por defecto; configúralos solo si los quieres. Ver [docs/DISCORD-PR-NOTIFICATIONS.md](docs/DISCORD-PR-NOTIFICATIONS.md).

## Actualizar y desinstalar

- **Actualizar:** `apm update` y haz commit de `apm.yml` y `apm.lock.yaml`.
- **Desinstalar:** `apm uninstall venturars/delivery-workflow`. El `.env` es tuyo: bórralo o déjalo.

## Más información

- [CONTRIBUTING.md](CONTRIBUTING.md): cómo proponer un cambio y cómo trabajar en este repositorio.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md): cómo se prueba y se publica una versión.
- [CHANGES.md](CHANGES.md): de dónde sale el paquete y qué cambia respecto al original.
- [GLOSSARY.md](GLOSSARY.md): vocabulario del flujo.
- [docs/](docs/): el resto de la documentación.

El paquete tiene licencia Apache 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)).
