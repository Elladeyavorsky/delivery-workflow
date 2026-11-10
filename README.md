# delivery-workflow

Paquete [APM](https://github.com/microsoft/apm) con un flujo de entrega para **Claude Code, Cursor y Codex**. Lleva una tarea desde la idea hasta la revisión sin salir del chat del agente.

## Qué hace

- **Piensa la tarea contigo.** Una entrevista en tandas de preguntas, cada una con su respuesta recomendada, hasta que la tarea está clara.
- **La deja escrita en GitHub.** Crea la issue con la plantilla y la etiqueta de su tipo, la rama `número-tipo-descripcion`, el commit `chore: open #N` y la pull request en draft enlazada a la issue.
- **Escribe la spec en la issue.** La spec, el plan y las tasks van en la propia issue, debajo de su plantilla, y las tasks se marcan a medida que se cumplen.
- **La implementa por rondas.** Hasta nueve rondas en las que un subagente escribe el código, otro escribe y ejecuta los tests y otro compara la documentación con el código. Cada ronda deja un comentario en la issue.
- **La cierra.** Un commit final con un mensaje convencional, el push y, si la issue nombra revisores, la petición de revisión.

Para solo cuando hace falta: si a la spec le falta un dato, si aparece un secreto o si la novena ronda falla. También tiene momentos sueltos: guardar un trozo en un commit, pedir revisión o lanzar otra pasada. Los detalles están en [Uso](#uso).

Sale de la plantilla de git de [`exercises/git-workflow-agent-template`](https://github.com/venturars/neoland-102026/tree/staging/exercises/git-workflow-agent-template) y el ciclo de agentes de [`exercises/ChromaDB`](https://github.com/venturars/neoland-102026/tree/staging/exercises/ChromaDB), del repositorio de origen, [venturars/neoland-102026](https://github.com/venturars/neoland-102026), generalizados para cualquier proyecto en GitHub. Los cambios respecto a esas dos piezas están en [CAMBIOS.md](CAMBIOS.md).

> **Estado de las pruebas:** probado de punta a punta en Claude Code. En Cursor y Codex se ha comprobado la instalación, pero el flujo está sin probar. Si usas una de esas herramientas, sigue [Probar el paquete](#probar-el-paquete) y cuenta qué pasa.

## Requisitos

- Un proyecto con git y un remoto `origin` en GitHub en el que puedas escribir.
- Claude Code, Cursor o Codex.
- La CLI de GitHub (`gh`). Abre las pull requests, crea las etiquetas, lee y escribe la spec en la issue y enlaza la pull request en Development.
- Node 20 o superior, para la spec en la issue y la caché de revisores.
- APM, para instalar el paquete. En un [repositorio compartido](#repositorio-compartido) solo lo necesita quien instala.
- Un token de GitHub en la variable `GITHUB_TOKEN`, para el MCP de GitHub.

## Guía de instalación

### 1. Prepara tu equipo

Una sola vez por ordenador. En macOS, con Homebrew:

```bash
brew install gh node apm
gh auth login
```

Sin Homebrew, APM se instala con `curl -sSL https://aka.ms/apm-unix | sh`. Comprueba las versiones con `gh --version`, `node --version` (20 o más) y `apm --version`.

Después, añade el token a tu `~/.zshrc` (o `~/.bashrc`) para que esté en cada sesión:

```bash
export GITHUB_TOKEN=$(gh auth token)
```

Si GitHub rechaza ese token, crea un token clásico con el permiso `repo` en <https://github.com/settings/tokens> y úsalo en su lugar.

### 2. Instala el paquete en el proyecto

Desde la raíz del proyecto, con la herramienta que uses en `--target`:

```bash
env -u GITHUB_TOKEN apm install venturars/delivery-workflow#v0.1.0 --target claude
```

- `--target` acepta `claude`, `cursor` o `codex`, y varios separados por comas (`--target claude,cursor,codex`).
- Mientras no exista la etiqueta `v0.1.0`, usa `#staging`.
- `env -u GITHUB_TOKEN` quita el token solo para ese comando. Si `GITHUB_TOKEN` está definida al instalar, APM escribe el valor del token en la configuración del MCP. Sin ella, escribe una referencia (`${GITHUB_TOKEN}`) que la herramienta resuelve al arrancar.

APM añade el paquete a `apm.yml`, fija la versión en `apm.lock.yaml` y deja:

| | Claude Code | Cursor | Codex |
|---|---|---|---|
| 18 skills | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` |
| 8 subagentes | `.claude/agents/` | `.cursor/agents/` | `.codex/agents/` |
| MCP `github` | `.mcp.json` | `.cursor/mcp.json` | `.codex/config.toml` |

Comprueba que la configuración del MCP lleva la referencia y no el token:

```bash
grep -nE 'gh[pousr]_|github_pat_' .mcp.json .cursor/mcp.json .codex/config.toml 2>/dev/null || echo "Sin tokens."
```

Haz commit de `apm.yml` y `apm.lock.yaml`. Si en el proyecto trabaja más gente, sigue [Repositorio compartido](#repositorio-compartido) en vez de este paso.

### 3. Abre tu herramienta

Ábrela desde una terminal en la que esté `GITHUB_TOKEN`, para que la herede.

- **Claude Code:** `claude`. Acepta el servidor `github` del proyecto cuando lo pregunte.
- **Cursor:** `cursor .`. Si lo abres desde el Dock, puede no ver `GITHUB_TOKEN`. En *Settings → MCP*, activa el servidor `github`. El paquete le añade la cabecera `X-MCP-Features: mcp_apps_disable_form_deferral`: sin ella, crear o editar una issue o una pull request abre un formulario sin botón de enviar y la llamada se queda esperando.
- **Codex:** `codex`. Acepta la confianza en el proyecto (*trusted*): sin ella, Codex no lee `.codex/config.toml`. `/mcp` muestra si el servidor `github` está conectado. Codex solo delega en subagentes cuando una skill se lo pide: el orquestador los nombra uno a uno.

### 4. Da los permisos

La primera vez que el flujo lanza cada script, la herramienta pide permiso. Acéptalos o apruébalos de una vez como explica [Permisos](#permisos).

### 5. Comprueba que funciona

En el chat del agente, escribe `/check-status` (en Codex, `$check-status`). Tiene que decir la rama base, `GITHUB_TOKEN definido`, `GitHub CLI: con sesión` y `Node: 20` o más. Si falta algo, lo dice y el flujo no arranca.

Después, pide tu primera tarea: `/delivery-workflow Crea la issue y hazla: …`.

### Actualizar y desinstalar

- **Otra versión:** cambia la etiqueta en `apm.yml` (por ejemplo, `#v0.1.0` por `#v0.2.0`), lanza `env -u GITHUB_TOKEN apm install` y haz commit de `apm.yml`, `apm.lock.yaml` y lo que haya cambiado.
- **Desinstalar:** `apm uninstall venturars/delivery-workflow` quita las skills, los subagentes y la entrada de `apm.yml`. El servidor `github` se queda en la configuración del MCP: bórralo a mano si ya no lo usas.

## Permisos

Las skills lanzan sus scripts con `bash` y `node`, y llaman a `git` y `gh`. La primera vez que el flujo usa cada comando, la herramienta pide permiso.

- **Claude Code:** acepta cada aviso con «Yes, and don't ask again», o apruébalos de una vez en `.claude/settings.local.json`, que es tuyo y no se sube:

  ```json
  {
    "permissions": {
      "allow": ["Bash(bash:*)", "Bash(node:*)", "Bash(git:*)", "Bash(gh:*)"]
    }
  }
  ```

  `Bash(bash:*)` y `Bash(node:*)` dejan pasar cualquier script, no solo los del paquete: ponlas solo en proyectos en los que confíes. Los comandos del proyecto, como `npm test`, piden su propio permiso.
- **Cursor y Codex:** sin probar. En Cursor, añade `bash`, `node`, `git` y `gh` a los comandos que el agente puede lanzar sin preguntar. En Codex, acepta cada comando cuando lo pida.

## Repositorio compartido

En un proyecto donde cada persona usa una herramienta distinta, una sola persona instala el paquete para Claude Code, Cursor y Codex y sube lo que genera. El resto no necesita APM: al hacer pull ya tiene las skills, los subagentes y el MCP de su herramienta. Si cada persona instalara por su cuenta, cada `apm.lock.yaml` saldría distinto y las pull requests que lo incluyan chocarían entre sí.

Instalación única, en una pull request de tipo `chore`:

1. En la raíz, desde una rama de trabajo, instala para las tres herramientas sin el token en el entorno:

   ```bash
   env -u GITHUB_TOKEN apm install venturars/delivery-workflow#v0.1.0 --target claude,cursor,codex
   ```

   APM añade `apm_modules/` a `.gitignore`.

2. Comprueba que la configuración del MCP lleva la referencia a la variable y no el valor del token:

   ```bash
   grep -nE 'gh[pousr]_|github_pat_' .mcp.json .cursor/mcp.json .codex/config.toml || echo "Sin tokens."
   ```

   Si sale una línea, no hagas commit: borra esos tres ficheros y repite el paso 1 en una terminal sin `GITHUB_TOKEN`.

3. Añade `.claude/settings.local.json` a `.gitignore`: guarda los permisos de cada persona. Después, haz commit de `apm.yml`, `apm.lock.yaml`, `.gitignore`, `.mcp.json`, `.claude/`, `.cursor/`, `.codex/` y `.agents/`.

Cada persona sigue necesitando lo de [Requisitos](#requisitos) salvo APM: `gh` con sesión, Node 20 o superior y `GITHUB_TOKEN` al abrir su herramienta. En Cursor tiene que activar el servidor `github` y en Codex confiar en el proyecto.

Para cambiar de versión, la misma persona repite los tres pasos con la etiqueta nueva, en otra pull request `chore`. Nadie más lanza `apm install` en ese proyecto: reescribiría el lockfile solo para su herramienta.

## Uso

Llama al orquestador o pide directamente un momento:

| Herramienta | Cómo llamar al orquestador |
|---|---|
| Claude Code | `/delivery-workflow` |
| Cursor | `/delivery-workflow` en el chat del agente |
| Codex | `$delivery-workflow` (o `/skills`) |

| Momento | Ejemplo | Qué pasa |
|---|---|---|
| Pensar la tarea | «Ayúdame a pensar cómo contar usuarios por género» | Una entrevista en tandas de preguntas, cada una con su respuesta recomendada, y un resumen. |
| Dejarla escrita | «Crea la issue y hazla» | Issue con la plantilla y la etiqueta de su tipo, rama `N-tipo-…`, commit `chore: open #N`, push, pull request en draft con `Closes #N` y la etiqueta, spec en la issue, rondas comentadas en la issue, commit final y push. Si la issue tiene una línea `Revisan:`, pide esas revisiones. |
| Dejarla escrita, solo git | «Crea la issue, solo git» | Lo mismo hasta la pull request en draft enlazada. Sin ciclo: el trabajo es tuyo. |
| Guardar un trozo | «Guarda `src/users.js` con feat: count users by gender» | Commit solo con esos ficheros y push. |
| Que la revisen | «Que la revisen Ana y Luis» | Nombres resueltos a logins, revisiones pedidas y pull request fuera de draft. |
| Otra pasada | «Otra pasada» | Solo después de que la ronda 9 falle: el ciclo vuelve a empezar con la spec corregida. |

### El ciclo

Al dejar la tarea escrita, sin esperar a nadie:

1. `concept-developer` escribe `## Spec`, `## Plan` y `## Tasks` en la issue, debajo de la plantilla del tipo.
2. Hasta 9 rondas. En cada una, un `code-developer` nuevo implementa una task, un `code-tester` nuevo escribe y ejecuta los tests (unitarios, de lógica de negocio, de UI y de punta a punta, los que diga el plan) y un `concept-tester` nuevo compara la documentación y la spec con el código. Cada ronda deja un comentario en la issue.
3. Si pasa, la spec queda como Implementada, se hace el commit final y se sube.
4. Si la ronda 9 falla, la issue recibe un informe y nada se sube hasta que confirmes otra pasada.

El ciclo para por su cuenta solo en tres casos: un hueco en la spec que el proyecto no responde (te pregunta), un secreto en un fichero (nombra el fichero, no el valor) y la ronda 9 fallida. Si editas la parte de arriba de la issue mientras corre, también para y te pregunta.

Los agentes leen los documentos del proyecto que existan (`README.md`, `AGENTS.md`, `docs/CONSTITUTION.md`, `docs/ARCHITECTURE.md`, `docs/STYLE.md`, `docs/COMMANDS.md`) y no crean los que faltan. Los comandos de tests y de lint salen de `docs/COMMANDS.md` o, si no está, del manifiesto del proyecto (`package.json`, `pyproject.toml`…).

## Rama base

Las ramas de trabajo salen de la rama base y las pull requests van contra ella. Se detecta sola, en este orden:

1. La variable `GIT_WORKFLOW_BASE`, si está definida.
2. `staging`, si existe `origin/staging`.
3. La rama por defecto del remoto (`origin/HEAD`), y si no, `main` o `master`.

Para fijarla: `export GIT_WORKFLOW_BASE=develop`.

## Convenciones

Son reglas del paquete, no opciones:

- Siete tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` y `knowledge`. Cualquier otro se rechaza.
- Ramas `número-tipo-descripcion`.
- La issue y la pull request llevan una etiqueta con el nombre exacto del tipo. Si no existe, se crea. Si tu cuenta no puede crear etiquetas, se crean sin ella y se avisa.
- Commits en conventional commits, en inglés, con desglose y pie (`Closes #N` o `Refs #N`).
- Cuerpos en español.
- Sin force push y sin `git add -A`.

## Contenido

| Pieza | Tipo | Qué hace |
|---|---|---|
| `delivery-workflow` | skill | Orquestador: reconoce el momento, llama a quien toca y lleva el ciclo. |
| `help-me-to-think` | skill | Elige la entrevista y cierra con un resumen. |
| `entrevista-con-repo`, `entrevista-libre` | skills | Las dos entrevistas. |
| `create-issue`, `create-branch`, `create-commit`, `create-pr` | subagentes | Un paso de git o de GitHub cada uno. |
| `concept-developer`, `code-developer`, `code-tester`, `concept-tester` | subagentes | El ciclo: spec y docs, código, tests y comprobación de concepto. |
| `check-status`, `pull-changes`, `create-branch`, `create-empty-commit`, `commit-changes`, `launch-push` | skills con script | Los pasos de git. |
| `create-issue`, `create-pr-base`, `assign-author`, `assign-reviewers`, `create-draft`, `link-pr-to-issue` | skills con MCP o `gh` | Los pasos de GitHub. |
| `github-cache` | skill con script | Recuerda durante 48 horas qué login es cada revisor. Vive en `.git/`. |
| `issue-spec` | skill con script | Lee y escribe la spec, el plan y las tasks en la issue sin tocar su parte de arriba. |

Las decisiones de diseño están en [docs/adr/](docs/adr/) y el vocabulario en [GLOSSARY.md](GLOSSARY.md).

## Tests del paquete

Para quien cambia el paquete, desde esta carpeta:

```bash
node --test tests/issue-spec.test.mjs
bash tests/scripts.test.sh
```

Los dos usan un `gh` falso y un remoto local: no tocan GitHub.

## Probar el paquete

Una prueba de unos veinte minutos en un repositorio desechable, para comprobar el paquete en tu herramienta antes de usarlo en un proyecto de verdad. Está pensada sobre todo para Cursor y Codex, que no se han probado de punta a punta.

1. Crea un repositorio de prueba con algo que probar y entra en él:

   ```bash
   gh repo create delivery-test --private --add-readme --clone
   cd delivery-test
   npm init -y && npm pkg set scripts.test="node --test"
   git add package.json && git commit -m "chore: add package.json" && git push
   ```

2. Instala el paquete sin el token en el entorno (ver Requisitos) y define el token después:

   ```bash
   env -u GITHUB_TOKEN apm install venturars/delivery-workflow#staging --target cursor
   export GITHUB_TOKEN=$(gh auth token)
   ```

   Para Codex, `--target codex`. Para probar una copia local del paquete, pasa su ruta en vez de `venturars/…#staging`.

3. Comprueba que están las piezas:
   - **Cursor:** `ls .agents/skills .cursor/agents` (18 skills y 8 subagentes) y `cat .cursor/mcp.json` (servidor `github` con `Bearer ${env:GITHUB_TOKEN}` y `X-MCP-Features`).
   - **Codex:** `ls .agents/skills .codex/agents` (18 skills y 8 subagentes `.toml`) y `cat .codex/config.toml` (`[mcp_servers.github]` con `bearer_token_env_var = "GITHUB_TOKEN"` y `X-MCP-Features` en `http_headers`).

4. Abre la herramienta desde esa misma terminal, para que herede `GITHUB_TOKEN`: `cursor .` o `codex`. En Codex, acepta la confianza en el proyecto.

5. Comprueba el MCP: en Cursor, *Settings → MCP*, el servidor `github` activado y con herramientas; en Codex, `/mcp`.

6. En el chat del agente, sigue estos pasos y comprueba el resultado de cada uno. Acepta los permisos que pida la herramienta. En Codex, llama a las skills con `$` en vez de `/`.

   | Escribe | Tiene que pasar |
   |---|---|
   | `/check-status` | `Rama base: main`, `Token de GitHub: GITHUB_TOKEN definido`, `GitHub CLI: con sesión` y `Node: 20` o más. |
   | `/delivery-workflow` «Crea la issue y hazla: una función `sum(a, b)` en `sum.js` que suma dos números, con su test» | Issue #1 con la etiqueta `feat`. Rama `1-feat-…`, commit `chore: open #1`, pull request en draft con `Closes #1` y la etiqueta. Después, en la issue, `## Spec`, `## Plan` y `## Tasks` y un comentario por ronda. Al final, un commit con `sum.js` y su test, subido. |
   | Edita la parte de arriba de la issue en GitHub mientras corren las rondas | La escritura siguiente en la issue para y el agente te pregunta. |
   | «Que la revise TU_NOMBRE» | Te contesta que el autor no puede revisar su propia pull request y no pide nada. |

   Compruébalo también fuera del chat: `git log --oneline`, `gh issue view 1 --comments` y `gh pr view --web`.

7. Anota lo que falle: la herramienta, el paso, lo que escribiste y el error. Ábrelo como issue en [este repositorio](https://github.com/venturars/delivery-workflow/issues) con el tipo `fix`.

8. Borra el repositorio de prueba: `gh auth refresh -s delete_repo` y después `gh repo delete delivery-test --yes`.

## Publicar una versión

Para quien mantiene el paquete. Los cambios entran en `staging` por pull request desde su rama de trabajo. Para publicar, sube `version` en `apm.yml`, haz merge de `staging` en `main` y etiqueta ese commit de `main` con `v<versión>`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Los proyectos instalan desde la etiqueta, así que `staging` puede cambiar sin afectarles ([ADR 0006](docs/adr/0006-el-paquete-vive-en-su-propio-repositorio.md)).
