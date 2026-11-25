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

## Avisos opcionales de PR en Discord

Un proyecto puede activar los [workflows de aviso](docs/DISCORD-PR-NOTIFICATIONS.md) para sus PR hacia `staging`. APM no los instala y los agentes no intervienen. En este repositorio el bot publica en Discord cuando la PR está fuera de draft, tiene al menos un revisor pedido y el check `review` ha pasado en ese commit. Muestra los logins de GitHub y menciona solo a quienes pueda verificar.

Si falta una mención, el autor de la PR o un miembro autorizado del repositorio puede escribir **en un comentario de esa PR**:

```text
/discord-map LOGIN_GITHUB ID_DISCORD
```

Sustituye `LOGIN_GITHUB` por el login de un revisor solicitado y `ID_DISCORD` por su ID numérico. Para copiarlo, activa el modo desarrollador de Discord, abre el menú de esa persona y elige «Copiar ID de usuario». El workflow comprueba que el login sea revisor y que el ID pertenezca al servidor; después guarda la relación cifrada durante 48 horas y envía una mención adicional solo a esa persona. El comentario es visible en la PR: escribe únicamente el login y el ID, nunca el token del bot.

El comentario es opcional. Si alguien no está en Discord o nadie confirma la relación, la revisión en GitHub y el aviso de la PR continúan sin esa mención.

## Requisitos

- Un proyecto con git y un remoto `origin` en GitHub en el que puedas escribir.
- [GitHub CLI](https://cli.github.com) (`gh`), Node 20 o superior y APM. `gh` no necesita sesión. El MCP de EUR-Lex necesita Node 24 o superior ([Protección de datos](#protección-de-datos)).
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

6. (Opcional) Configura el canal de documentación: Context7 con `/setup-context7` o el RAG local con `/setup-docs-rag`, según se describe en [Documentación de las dependencias](#documentación-de-las-dependencias).

7. (Opcional) Genera la documentación de compliance del proyecto con `/setup-compliance`, según se describe en [Documentación de compliance](#documentación-de-compliance).

## Documentación de las dependencias

`code-developer` y `code-tester` consultan la documentación oficial de la versión que usa tu proyecto antes de usar una API de una dependencia. La leen por uno de estos canales, cada uno con su propio MCP:

| Canal | MCP | Qué sale del ordenador | Requisitos |
|---|---|---|---|
| **Context7** (por defecto) | `context7`, remoto | El nombre de la librería y la pregunta, hacia Upstash | Ninguno |
| **RAG local** | `docs-rag`, local | Solo la descarga de la documentación | Docker, Ollama y `uv` |

Context7 se registra en la config de usuario de cada herramienta, fuera de git: `~/.claude.json` (Claude Code), `~/.cursor/mcp.json` (Cursor) y `~/.codex/config.toml` (Codex). `docs-rag` se registra en la config de cada proyecto: `.mcp.json`, `.cursor/mcp.json` y `.codex/config.toml`. Solo hay un canal activo: `/setup-docs-rag` quita Context7 de la config de usuario y su regla del proyecto, y `/setup-context7` quita `docs-rag` de la config del proyecto. Como la config de Context7 es de usuario, pasar un proyecto al RAG local deja sin Context7 a los demás proyectos de ese ordenador hasta que vuelvas a lanzar `/setup-context7`. `apm install` y `apm update` no tocan esta elección.

Las dos skills leen las dependencias de tu proyecto (`package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`), en la raíz y en cualquier subcarpeta. En un repositorio git las buscan con `git ls-files`, así que respetan `.gitignore` (sin `node_modules` ni `dist`) y no tienen límite de profundidad; sin git recorren hasta 3 niveles. Proponen todas salvo los tipos y las utilidades de build y piden confirmación una sola vez.

### Context7

[Context7](https://context7.com) da a los agentes la documentación actual y de la versión concreta de cada librería, para que no escriban código para versiones antiguas.

`/setup-context7` escribe el MCP `context7` en la config de usuario, sin tocar otros MCP, y deja una regla con tus librerías en `AGENTS.md` o `CLAUDE.md`.

**La clave es opcional.** Context7 funciona sin ella, con un límite menor de peticiones. Si quieres más, crea una clave gratis en context7.com/dashboard y añádela a tu `.env`, junto al token de GitHub:

```dotenv
CONTEXT7_API_KEY=tu-clave
```

Los editores no leen el `.env` solos. Antes de abrir el editor, cárgalo en la terminal y ábrelo desde ahí:

```bash
set -a; source .env; set +a
cursor .      # o claude, o codex
```

### RAG local

`/setup-docs-rag` indexa en tu ordenador la documentación oficial de cada dependencia y de cada runtime fijado (Python, Node, Go y Rust), en la versión exacta del lockfile. Sin lockfile usa la mínima del rango y lo avisa. Después instala y registra en el proyecto el MCP `docs-rag`, con dos herramientas: `resolve_package` y `query_docs`. Sus datos y sus respuestas tienen las claves en inglés.

- **Requisitos:** [Docker](https://www.docker.com) (arranca Qdrant en el contenedor `docs-rag-qdrant`), [Ollama](https://ollama.com) (descarga `nomic-embed-text`) y [uv](https://docs.astral.sh/uv/) (descarga Python 3.15 si no está y prepara el entorno en `.docs-rag/venv`). La primera vez descarga también el reordenador, unos cientos de MB con PyTorch.
- **En el proyecto, fuera de git:** el código del MCP, su entorno y el índice van en `.docs-rag/`, que trae su propio `.gitignore`.
- **Registro:** `docs-rag` va en `.mcp.json`, `.cursor/mcp.json` y `.codex/config.toml` del proyecto, con rutas relativas. Si subes esos ficheros a git, quien no haya lanzado `/setup-docs-rag` verá un MCP que no arranca.
- **Desde una versión anterior:** `/setup-docs-rag` quita el `docs-rag` de la config de usuario y vuelve a indexar todo, porque el índice anterior tenía los metadatos en español. `~/.docs-rag/` ya no se usa: puedes borrarlo.
- **Tras cambiar dependencias:** repite `/setup-docs-rag`. Solo reindexa lo que cambió.
- **Receta:** troceo por la estructura del Markdown, `nomic-embed-text`, Qdrant y reordenado con MiniLM-L6, medida en [docs/research/rag-documentacion-python-3.15.pdf](docs/research/rag-documentacion-python-3.15.pdf). Cada tipo de documentación (Sphinx, MkDocs, Markdown, Node, TypeDoc, Go y Rust) guarda sus propios metadatos para filtrar.

## Docker

La skill `docker-best-practices` reúne las reglas para el Docker de un proyecto: decidir para qué es Docker, fijar cada versión (imagen, herramientas, binarios con su checksum y paquetes de `apt-get` con fecha de snapshot), separar las dependencias de cada proyecto en volúmenes, y comprobar antes de la pull request. El agente la usa al crear, cambiar o revisar un `Dockerfile`, un `docker-compose.yml` o un `devcontainer.json`. También puedes pedirla tú: «Revisa el Dockerfile con docker-best-practices».

Trae plantillas de `Dockerfile` y `docker-compose.yml`, y un script que revisa un `Dockerfile` y avisa de lo que no tiene versión fija:

```bash
bash .agents/skills/docker-best-practices/scripts/check-docker.sh Dockerfile
```

En Claude Code, la carpeta es `.claude/skills/docker-best-practices/`.

## Arquitectura en capas

La skill `layered-architecture-guideline` fija cuatro capas (presentación, aplicación, dominio e infraestructura) más shared, las dependencias hacia dentro y los errores de dominio, con mínimos de seguridad para toda la arquitectura. Decide dónde va cada pieza y cómo se separa. Respeta la estructura que impone un framework.

La usan `concept-developer` y `code-developer`. `code-tester` y `concept-tester` siguen el plan, no la precargan.

Si falta `docs/ARCHITECTURE.md`, `concept-developer` lo crea desde la plantilla de la skill y deja `Por decidir` lo que no sabe. Si existe, añade las secciones de la plantilla que falten y conserva lo que ya hay; no sustituye el fichero. Escribe en el plan el mapa archivo → capa. `code-developer` coloca el código en su capa.

El mapa de capas es independiente del lenguaje. Cada proyecto elige y anota en `docs/ARCHITECTURE.md` la herramienta que verifica las fronteras; los agentes la proponen según el stack.

## Protección de datos

La guía `data-protection-guideline` es un checklist del RGPD y la LOPDGDD que usan `concept-developer`, `concept-tester` y `legal-advisor`. Se activa con la sección `## Datos personales` de `docs/CONSTITUTION.md` del proyecto, señala posibles problemas de cada tarea con su artículo y no certifica cumplimiento.

Para activarla, copia la plantilla `assets/datos-personales.md` de la skill (en Claude Code, `.claude/skills/data-protection-guideline/`; en Cursor y Codex, `.agents/skills/data-protection-guideline/`) a tu `docs/CONSTITUTION.md` y rellena sus cuatro campos: rol en el tratamiento, interesados, categorías especiales y estado de la DPIA. El rol lo decide la persona responsable del proyecto; la guía no lo deduce. Un campo vacío es un hueco y para el ciclo.

Sin la sección, la guía dice en una línea que no actúa. Con ella:

- Si la tarea toca datos personales, la spec recoge como requisitos los ítems que aplican, con su artículo. Si el código o la documentación no los cumplen, la ronda falla como con cualquier otro requisito. `code-tester` y `code-developer` no precargan la guía: siguen la spec.
- Lo que `concept-tester` encuentra fuera de la spec va como nota al comentario de la ronda y no cambia el veredicto.
- Sin hallazgos, el reporte dice «Sin hallazgos frente al checklist vX.Y.Z (AAAA-MM-DD).».
- Una duda que el checklist no resuelve va a `legal-advisor` como consulta legal ([Consultas legales con EUR-Lex](#consultas-legales-con-eur-lex)).

Los artículos citados viajan en la skill como copia informativa de los textos consolidados, con su fuente y su fecha. El checklist está pendiente de revisión jurídica.

### Consultas legales con EUR-Lex

`concept-developer` y `concept-tester` devuelven las dudas que la guía no resuelve como consultas legales, cada una con su id `CL-NN`. El orquestador las pasa todas a la vez al agente `legal-advisor`, que las resuelve primero con la guía y después con el MCP de EUR-Lex, y publica en la issue un comentario con la respuesta, los artículos y la fuente de cada una: la guía con la versión del checklist, o EUR-Lex con el CELEX y la fecha. Después, `concept-developer` escribe en la spec los requisitos que salen de las respuestas, con el id y el artículo: `(CL-01; RGPD 46)`. La consulta no gasta ronda. El comentario no certifica cumplimiento.

Lo que `legal-advisor` no resuelve es un hueco y el orquestador te lo pregunta. EUR-Lex solo tiene derecho de la UE: para la LOPDGDD, `legal-advisor` usa los artículos empaquetados, y un artículo que no está empaquetado es un hueco.

El MCP es `@cyanheads/eur-lex-mcp-server`, fijado a la versión 0.21.0, y corre en local con `npx`. No necesita clave. Viene con el paquete: `apm install` escribe el servidor `eur-lex` en `.mcp.json`, `.cursor/mcp.json` o `.codex/config.toml`, según tus herramientas, sin tocar otros MCP. No hay que configurar nada. Recarga el editor o la sesión después de instalar.

**Necesita Node 24 o superior.** Sin él, `legal-advisor` responde solo con la guía y el comentario dice que no usó EUR-Lex. El resto del paquete funciona con Node 20.

## Documentación de compliance

`/setup-compliance` (en Codex, `$setup-compliance`) genera en `docs/` del proyecto la base de los documentos que piden el AI Act y el RGPD. Se lanza a mano tras `apm install`; la instalación no la ejecuta.

| Documento | Qué trae | Cuándo lo propone |
|---|---|---|
| `docs/ai-act.md` | Clasificación del sistema según el Reglamento (UE) 2024/1689: prohibido, alto riesgo, riesgo limitado o riesgo mínimo, con el motivo y los artículos | Siempre |
| `docs/dpia.md` | Evaluación de impacto del RGPD 35.7: tratamiento y fines, necesidad y proporcionalidad, riesgos y medidas | Siempre |
| `docs/security.md` | Threat model: activos, actores, amenazas (incluidas inyección de instrucciones, fuga de datos por las respuestas y envenenamiento de datos) y una mitigación por amenaza | Siempre |
| `docs/system-card.md` | Ficha del sistema, para quien lo opera | Siempre |
| `docs/model-card.md` | Ficha del modelo, para quien lo usa | Con ficheros de pesos o una dependencia de entrenamiento |
| `docs/data-card.md` | Ficha de los datos, para quien los audita | Con ficheros de pesos, una dependencia de entrenamiento o ficheros de datos de entrenamiento |

La skill lee el proyecto sin escribir nada: las dependencias de IA de `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod` y `Cargo.toml`, los ficheros de pesos de modelo (`.safetensors`, `.onnx`, `.pt`, `.pth`, `.gguf`, `.h5`, `.joblib`, `.pkl`) y la sección `## Datos personales` de `docs/CONSTITUTION.md`. La lista de dependencias que cuentan está en `assets/ai-signals.json` de la skill. Después te entrevista en tandas, con una respuesta recomendada por pregunta, y confirma una vez qué documentos genera; puedes quitar o añadir fichas. Si `data-protection-guideline` está instalada, la DPIA usa sus ítems `DP-NN` para los riesgos y las medidas.

En cada documento:

- Cada afirmación cita su fuente: un fichero del proyecto, la sección de `docs/CONSTITUTION.md` o «entrevista (AAAA-MM-DD)».
- Lo que la skill no deduce ni obtiene en la entrevista queda como `> **Hueco:** <qué falta>`, para que lo rellenes.
- La última línea dice «Documento orientativo: no certifica cumplimiento ni es asesoramiento jurídico.». La skill no escribe un documento sin ella.

**No pisa lo que editas.** Cada documento generado empieza por `<!-- setup-compliance sha256=… -->`, el hash del resto del fichero. Al repetir `/setup-compliance`, un documento sin editar se actualiza; uno que editaste, o que escribiste tú sin esa marca, se conserva tal cual. Al terminar, la skill muestra una tabla con cada documento, su ruta, el resultado (`creado`, `igual`, `actualizado` o `conservado`) y el número de huecos.

La skill no cambia `docs/CONSTITUTION.md` ni mantiene los documentos al día en cada tarea: repítela cuando el proyecto cambie.

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
