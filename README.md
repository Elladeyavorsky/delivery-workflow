# delivery-workflow

Paquete [APM](https://github.com/microsoft/apm) para Claude Code, Cursor y Codex que lleva una tarea de GitHub desde la idea hasta la revisión, sin salir del chat del agente.

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
- [GitHub CLI](https://cli.github.com) (`gh`), APM y Node 20+, y 24+ solo para `legal-advisor` con EUR-Lex. `gh` no necesita sesión.
- Un `.env` en la raíz del proyecto con tu token de GitHub. Sin eso, el flujo no arranca ([El token de GitHub](#el-token-de-github)).

## Instalación

### Preparar el equipo

Una sola vez. Elige tu sistema.

**macOS y Linux:**

```bash
brew install gh node apm          # sin Homebrew: curl -sSL https://aka.ms/apm-unix | sh
```

**Windows:** los scripts del paquete son de `bash`, así que hace falta un entorno de tipo Unix.

- **WSL (recomendada, vale para las tres herramientas).** En PowerShell como administrador, `wsl --install`, y reinicia. Abre **Ubuntu**, clona el proyecto dentro de WSL (por ejemplo, en `~/proyectos`) e instala las herramientas. Después sigue desde [Instalar el paquete](#instalar-el-paquete) y abre tu herramienta desde la terminal de Ubuntu (`claude`, `codex` o `cursor .`; Cursor abre el proyecto conectado a WSL). El `.env` va en la raíz del proyecto, dentro de WSL.

  ```bash
  sudo apt update && sudo apt install -y gh
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  source ~/.bashrc && nvm install 22      # el Node de apt puede ser demasiado antiguo
  curl -sSL https://aka.ms/apm-unix | sh
  ```

- **Git Bash (solo Claude Code).** Instala [Git for Windows](https://git-scm.com/download/win), que trae Git Bash. Claude Code lo usa para lanzar comandos. Instala en PowerShell las herramientas. Después abre **Git Bash** y sigue desde [Instalar el paquete](#instalar-el-paquete).

  ```powershell
  winget install --id GitHub.cli
  winget install --id OpenJS.NodeJS.LTS
  winget install --id Microsoft.APM --exact --source winget
  ```

### Instalar el paquete

Desde la raíz del proyecto. En `--target` pon tu herramienta: `claude`, `cursor`, `codex` o varias separadas por comas.

```bash
apm install venturars/delivery-workflow --target claude
```

Haz commit de `apm.yml` y `apm.lock.yaml`. Las skills quedan en `.claude/skills/` (Claude Code) o en `.agents/skills/` (Cursor y Codex).

### El token de GitHub

Los agentes usan el token del `.env` para todo lo que hacen en GitHub (issues, pull requests, etiquetas, revisiones). La sesión de `gh` y las variables de tu terminal no entran en el flujo, así que no hace falta abrir tu herramienta desde la terminal: basta con que encuentre `gh` y `node`, y `/check-status` lo comprueba.

1. Crea un token **clásico** con el permiso `repo` en <https://github.com/settings/tokens/new?scopes=repo>. Que sea de tu cuenta: todo lo que haga el flujo aparecerá a tu nombre. Los tokens *fine-grained* no sirven en repositorios personales de otra persona.
2. En la raíz del proyecto, crea o abre el fichero `.env` y añade esta línea, con tu token:

   ```
   GITHUB_TOKEN=ghp_tu_token
   ```

3. Añade `.env` a `.gitignore`: `echo .env >> .gitignore`.

Cada persona tiene su propio `.env` con su propio token. El `.env` se queda en tu equipo: no lo subas al repositorio. El push sigue usando tus credenciales de git.

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

### Permisos

La primera vez que el flujo lanza `bash`, `node`, `git` o `gh`, la herramienta pide permiso. En Claude Code puedes aprobarlos de una vez en `.claude/settings.local.json`, solo en proyectos en los que confíes:

```json
{ "permissions": { "allow": ["Bash(bash:*)", "Bash(node:*)", "Bash(git:*)", "Bash(gh:*)"] } }
```

## Opcionales

- **Modelos de los agentes:** `/configure-models` elige el modelo de cada agente según tu suscripción. `apm install` y `apm update` borran la línea `model`: repite el comando después de cada uno. Detalle en [docs/MODELS.md](docs/MODELS.md).
- **[Documentación de las dependencias](#documentación-de-las-dependencias):** Context7 o RAG local, para que los agentes lean la documentación de la versión que usas.
- **[Docker](#docker):** reglas para el Docker del proyecto.
- **[Protección de datos](#protección-de-datos):** checklist del RGPD y la LOPDGDD para cada tarea.
- **Compliance:** `/setup-compliance` genera los documentos del AI Act y el RGPD. Ver [docs/COMPLIANCE.md](docs/COMPLIANCE.md).
- **Avisos de PR en Discord:** workflows que avisan de las PR listas para revisar; APM no los instala. Ver [docs/DISCORD-PR-NOTIFICATIONS.md](docs/DISCORD-PR-NOTIFICATIONS.md).

### Documentación de las dependencias

`code-developer` y `code-tester` consultan la documentación oficial de la versión que usa tu proyecto antes de usar una API de una dependencia. Las dos skills leen las dependencias de `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod` y `Cargo.toml`, en la raíz y en las subcarpetas. En un repositorio git las busca con `git ls-files` (sin `node_modules` ni `dist`), que respeta `.gitignore` y no limita la profundidad; sin git recorre hasta 3 niveles. Proponen todas salvo los tipos y las utilidades de build, y piden confirmación una sola vez.

| Canal | MCP | Qué sale del ordenador | Requisitos |
|---|---|---|---|
| **Context7** (por defecto) | `context7`, remoto | El nombre de la librería y la pregunta, hacia Upstash | Ninguno |
| **RAG local** | `docs-rag`, local | Solo la descarga de la documentación | Docker, Ollama y `uv` |

Solo hay un canal activo: `/setup-docs-rag` quita Context7 de la config de usuario y su regla del proyecto, y `/setup-context7` quita `docs-rag` de la config del proyecto. `apm install` y `apm update` no tocan esta elección.

> **Nota:** Context7 se registra en la config de usuario, así que pasar un proyecto al RAG local deja sin Context7 a los demás proyectos del ordenador hasta que repitas `/setup-context7`.

#### Context7

[Context7](https://context7.com) da a los agentes la documentación actual y de la versión concreta de cada librería, para que no escriban código para versiones antiguas. `/setup-context7` escribe el MCP `context7` en `~/.claude.json` (Claude Code), `~/.cursor/mcp.json` (Cursor) y `~/.codex/config.toml` (Codex), sin tocar otros MCP, y deja una regla con tus librerías en `AGENTS.md` o `CLAUDE.md`.

La clave es opcional: sin ella, el límite de peticiones es menor. Para usarla, crea una clave gratis en context7.com/dashboard y añádela al `.env`, junto al token de GitHub:

```dotenv
CONTEXT7_API_KEY=tu-clave
```

Los editores no leen el `.env` solos. Antes de abrir el editor, cárgalo en la terminal y ábrelo desde ahí:

```bash
set -a; source .env; set +a
cursor .      # o claude, o codex
```

#### RAG local

`/setup-docs-rag` indexa en tu ordenador la documentación oficial de cada dependencia y de cada runtime fijado (Python, Node, Go y Rust), en la versión exacta del lockfile; sin lockfile usa la mínima del rango y lo avisa. Después registra en el proyecto el MCP `docs-rag`, con las herramientas `resolve_package` y `query_docs`. Sus datos y sus respuestas tienen las claves en inglés.

- **Requisitos:** [Docker](https://www.docker.com) (arranca Qdrant en el contenedor `docs-rag-qdrant`), [Ollama](https://ollama.com) (descarga `nomic-embed-text`) y [uv](https://docs.astral.sh/uv/) (descarga Python 3.15 si no está y prepara el entorno en `.docs-rag/venv`). La primera vez descarga también el reordenador, unos cientos de MB con PyTorch.
- **En el proyecto, fuera de git:** el código del MCP, su entorno y el índice van en `.docs-rag/`, que trae su propio `.gitignore`.
- **Registro:** `docs-rag` va en `.mcp.json`, `.cursor/mcp.json` y `.codex/config.toml` del proyecto, con rutas relativas.
- **Tras cambiar dependencias:** repite `/setup-docs-rag`. Solo reindexa lo que cambió.
- **Receta:** troceo por la estructura del Markdown, `nomic-embed-text`, Qdrant y reordenado con MiniLM-L6, medida en [docs/research/rag-documentacion-python-3.15.pdf](docs/research/rag-documentacion-python-3.15.pdf). Cada tipo de documentación (Sphinx, MkDocs, Markdown, Node, TypeDoc, Go y Rust) guarda sus propios metadatos para filtrar.

> **Nota:** Quien no haya lanzado `/setup-docs-rag` verá un MCP que no arranca si subes los ficheros de config a git.

> **Nota:** Desde una versión anterior, `/setup-docs-rag` quita el `docs-rag` de la config de usuario y vuelve a indexar todo, porque el índice anterior tenía los metadatos en español. `~/.docs-rag/` ya no se usa: puedes borrarlo.

### Docker

La skill `docker-best-practices` reúne las reglas para el Docker de un proyecto: decidir para qué es Docker, fijar cada versión (imagen, herramientas, binarios con su checksum y paquetes de `apt-get` con fecha de snapshot), separar las dependencias de cada proyecto en volúmenes, y comprobar antes de la pull request. El agente la usa al crear, cambiar o revisar un `Dockerfile`, un `docker-compose.yml` o un `devcontainer.json`. También puedes pedirla tú: «Revisa el Dockerfile con docker-best-practices».

Trae plantillas de `Dockerfile` y `docker-compose.yml`, y un script que revisa un `Dockerfile` y avisa de lo que no tiene versión fija:

```bash
bash <carpeta de skills>/docker-best-practices/scripts/check-docker.sh Dockerfile
```

### Protección de datos

`data-protection-guideline` es un checklist del RGPD y la LOPDGDD que usan `concept-developer`, `concept-tester` y `legal-advisor`. Señala posibles problemas de cada tarea con su artículo. Tanto esta guía como `/setup-compliance` son orientativas: no certifican cumplimiento.

Para activarla, copia la plantilla `assets/datos-personales.md` de la skill a tu `docs/CONSTITUTION.md` y rellena sus cuatro campos: rol en el tratamiento, interesados, categorías especiales y estado de la DPIA. El rol lo decide la persona responsable del proyecto; la guía no lo deduce. Un campo vacío es un hueco y para el ciclo. Sin la sección, la guía dice en una línea que no actúa.

Con la sección:

- Si la tarea toca datos personales, la spec recoge como requisitos los ítems que aplican, con su artículo. Si el código o la documentación no los cumplen, la ronda falla como con cualquier otro requisito. `code-tester` y `code-developer` no precargan la guía: siguen la spec.
- Lo que `concept-tester` encuentra fuera de la spec va como nota al comentario de la ronda y no cambia el veredicto.
- Sin hallazgos, el reporte dice «Sin hallazgos frente al checklist vX.Y.Z (AAAA-MM-DD).».
- Una duda que el checklist no resuelve va a `legal-advisor` como consulta legal ([docs/LEGAL-CONSULTATIONS.md](docs/LEGAL-CONSULTATIONS.md)).

Los artículos citados viajan en la skill como copia informativa de los textos consolidados, con su fuente y su fecha. El checklist está pendiente de revisión jurídica.

## Actualizar y desinstalar

- **Actualizar:** `apm update` y haz commit de `apm.yml` y `apm.lock.yaml`.
- **Desinstalar:** `apm uninstall venturars/delivery-workflow`. El `.env` es tuyo: bórralo o déjalo.

## Más información

- [CONTRIBUTING.md](CONTRIBUTING.md): cómo proponer un cambio y cómo trabajar en este repositorio.
- [CHANGES.md](CHANGES.md): de dónde sale el paquete y qué cambia respecto al original.
- [docs/MODELS.md](docs/MODELS.md): criterio de elección del modelo de cada agente y motivo por el que no se versiona.
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md): documentos que genera `/setup-compliance`.
- [docs/LEGAL-CONSULTATIONS.md](docs/LEGAL-CONSULTATIONS.md): consultas legales y EUR-Lex.
- [docs/DISCORD-PR-NOTIFICATIONS.md](docs/DISCORD-PR-NOTIFICATIONS.md): avisos de PR en Discord y `/discord-map`.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md): tests, prueba en un repositorio desechable y cómo publicar una versión.
- [GLOSSARY.md](GLOSSARY.md): vocabulario del flujo.
