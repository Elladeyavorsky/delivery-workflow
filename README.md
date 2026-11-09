# delivery-workflow

Paquete [APM](https://github.com/microsoft/apm) con el flujo de entrega del bootcamp Neoland AI (10/2026) para **Claude Code, Cursor y Codex**. Lleva una tarea desde la idea hasta la revisión: la entrevista, la issue con su etiqueta, la rama, la pull request en draft enlazada, la spec en la issue y un ciclo de código y tests por rondas.

Une la plantilla de git de `exercises/git-workflow-agent-template` y el ciclo de agentes de `exercises/ChromaDB`, generalizados para cualquier proyecto en GitHub. Los cambios respecto a esas dos piezas están en [CAMBIOS.md](CAMBIOS.md).

> **Estado de las pruebas:** probado de punta a punta en Claude Code. En Cursor y Codex se ha comprobado la instalación, pero el flujo está sin probar. Si usas una de esas herramientas, sigue [Probar el paquete](#probar-el-paquete) y cuenta qué pasa.

## Requisitos

- Un proyecto con git y un remoto `origin` en GitHub.
- Claude Code, Cursor o Codex.
- La CLI de GitHub (`gh`) con sesión iniciada (`gh auth login`). Abre las pull requests, crea las etiquetas, lee y escribe la spec en la issue, y enlaza la pull request en Development.
- Node 20 o superior, para la spec en la issue y la caché de revisores.
- APM: `brew install apm` (o `curl -sSL https://aka.ms/apm-unix | sh`).
- Un token de GitHub en la variable `GITHUB_TOKEN` cuando arrancas el editor o el agente, para el MCP de GitHub. Con la CLI de GitHub:

  ```bash
  export GITHUB_TOKEN=$(gh auth token)
  ```

  Si GitHub rechaza ese token, crea un token clásico con el permiso `repo` en <https://github.com/settings/tokens> y úsalo en su lugar. Añade el `export` a tu `~/.zshrc` para que esté en cada sesión. Si la variable falta, `check-status` lo avisa.

> **Cuidado con el token al instalar.** Si `GITHUB_TOKEN` está definida cuando lanzas `apm install`, APM escribe el valor del token en la configuración del MCP (`.mcp.json`, `.cursor/mcp.json` o `.codex/config.toml`). Sin la variable, escribe una referencia (`${GITHUB_TOKEN}`) que se resuelve al arrancar la herramienta. Instala con `env -u GITHUB_TOKEN apm install …` y no subas nunca esos ficheros al repositorio.

## Instalación

Desde la raíz de tu proyecto, con la herramienta que uses en `--target`:

```bash
env -u GITHUB_TOKEN apm install venturars/neoland-102026/exercises/delivery-workflow-template#delivery-workflow--v0.1.0 --target claude
```

`--target` acepta `claude`, `cursor` o `codex`, y varios separados por comas (`--target claude,cursor`). Mientras no exista la etiqueta `delivery-workflow--v0.1.0`, usa `#staging`.

APM añade el paquete a tu `apm.yml`, fija la versión en `apm.lock.yaml` y deja:

| | Claude Code | Cursor | Codex |
|---|---|---|---|
| Skills | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` |
| Subagentes | `.claude/agents/` | `.cursor/agents/` | `.codex/agents/` |
| MCP `github` | `.mcp.json` | `.cursor/mcp.json` | `.codex/config.toml` |

Haz commit de `apm.yml` y `apm.lock.yaml`. Quien clone el proyecto solo tiene que lanzar `apm install`.

Lo que pide cada herramienta además:

- **Cursor:** comprueba en *Settings → MCP* que el servidor `github` está activado. El paquete le añade la cabecera `X-MCP-Features: mcp_apps_disable_form_deferral`: sin ella, crear o editar una issue o una pull request abre un formulario sin botón de enviar y la llamada se queda esperando. Si lo abres desde el Dock y no ve `GITHUB_TOKEN`, ábrelo desde la terminal con `cursor .`.
- **Codex:** Codex solo lee `.codex/config.toml` si el proyecto es de confianza (*trusted*). Acepta la confianza cuando Codex la pida al abrir el proyecto. `/mcp` muestra si el servidor `github` está conectado. Codex solo delega en subagentes cuando una skill se lo pide: el orquestador los nombra uno a uno.

## Repositorio compartido

En un repositorio donde trabajan muchas personas, como el del curso, conviene instalar el paquete una sola vez para todo el repositorio en vez de que cada persona lance su propio `apm install <paquete>` en la raíz. Si cada persona instala por su cuenta, en la raíz quedan ficheros sin seguimiento (`.agents/`, `apm.yml`, `apm.lock.yaml`, `.apm-local/`) y cada `apm.yml` y cada `apm.lock.yaml` salen distintos, así que las pull requests que los incluyan chocan entre sí.

Instalación única, en una sola pull request de quien mantiene el repositorio:

1. En la raíz, instala el paquete desde su carpeta del propio repositorio:

   ```bash
   env -u GITHUB_TOKEN apm install ./exercises/delivery-workflow-template --target claude
   ```

   `apm.yml` guarda la ruta relativa, así que cada copia del repositorio usa la versión del paquete que tiene en su propia carpeta, sin etiquetas.

2. Añade a `.gitignore` lo que genera cada instalación:

   ```gitignore
   .claude/
   .mcp.json
   .cursor/
   .codex/
   .agents/
   .apm-local/
   apm_modules/
   apm.lock.yaml
   ```

   El lockfile también se ignora: apunta a una carpeta del mismo repositorio y cambia según la herramienta de cada persona.

3. Haz commit solo de `apm.yml` y de `.gitignore`.

Después, cada persona, al hacer pull, instala para su herramienta sin nombrar el paquete:

```bash
env -u GITHUB_TOKEN apm install --target cursor
```

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
| `create-issue`, `create-branch`, `create-commit`, `launch-push`, `create-pr` | subagentes | Un paso de git o de GitHub cada uno. |
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
   env -u GITHUB_TOKEN apm install venturars/neoland-102026/exercises/delivery-workflow-template#staging --target cursor
   export GITHUB_TOKEN=$(gh auth token)
   ```

   Para Codex, `--target codex`. Para probar una copia local del paquete, pasa su ruta en vez de `venturars/…#staging`.

3. Comprueba que están las piezas:
   - **Cursor:** `ls .agents/skills .cursor/agents` (18 skills y 9 subagentes) y `cat .cursor/mcp.json` (servidor `github` con `Bearer ${env:GITHUB_TOKEN}` y `X-MCP-Features`).
   - **Codex:** `ls .agents/skills .codex/agents` (18 skills y 9 subagentes `.toml`) y `cat .codex/config.toml` (`[mcp_servers.github]` con `bearer_token_env_var = "GITHUB_TOKEN"` y `X-MCP-Features` en `http_headers`).

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

7. Anota lo que falle: la herramienta, el paso, lo que escribiste y el error. Ábrelo como issue en el repositorio del curso con el tipo `fix`.

8. Borra el repositorio de prueba: `gh auth refresh -s delete_repo` y después `gh repo delete delivery-test --yes`.

## Publicar una versión

Para quien mantiene el paquete: sube `version` en `apm.yml`, haz merge en `staging` y etiqueta ese commit con `delivery-workflow--v<versión>`:

```bash
git tag delivery-workflow--v0.1.0
git push origin delivery-workflow--v0.1.0
```

El prefijo hace falta porque las etiquetas son de todo el repositorio del curso ([ADR 0003](docs/adr/0003-paquete-dentro-del-repositorio-del-curso.md)).
