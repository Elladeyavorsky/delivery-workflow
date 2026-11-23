# Mantenimiento

Para quien cambia o publica el paquete.

## Tests del paquete

Desde la raíz del repositorio:

```bash
node --test tests/*.mjs
node --test tests/discord-pr-notifications/*.test.mjs
bash tests/scripts.test.sh
uv run --no-project --python 3.15 --with pytest --with markdownify --with beautifulsoup4 python -m pytest -p no:cacheprovider tests/docs_rag
bash tests/apm-audit.test.sh
```

Los tests de Python cubren el paquete `docs_rag` de `/setup-docs-rag` sin red, Qdrant ni modelos; necesitan [uv](https://docs.astral.sh/uv/). `bash tests/apm-audit.test.sh` crea una copia temporal del paquete, excluye el estado local y los artefactos generados, regenera allí los artefactos APM y ejecuta `apm audit --ci`. Al terminar, elimina la copia temporal y deja intacto el checkout.

El aviso de PR de este repositorio y su acción compuesta se describen en [DISCORD-PR-NOTIFICATIONS.md](DISCORD-PR-NOTIFICATIONS.md). APM no instala workflows de GitHub en los proyectos.

## Probar el paquete

Una prueba de unos veinte minutos en un repositorio desechable, para comprobar el paquete en tu herramienta antes de usarlo en un proyecto de verdad. Está pensada sobre todo para Cursor y Codex, que no se han probado de punta a punta.

1. Crea un repositorio de prueba con algo que probar y entra en él:

   ```bash
   gh repo create delivery-test --private --add-readme --clone
   cd delivery-test
   npm init -y && npm pkg set scripts.test="node --test"
   git add package.json && git commit -m "chore: add package.json" && git push
   ```

2. Instala el paquete y crea el `.env` con tu token (ver [El token de GitHub](../README.md#el-token-de-github)):

   ```bash
   apm install venturars/delivery-workflow#staging --target cursor
   echo .env >> .gitignore && git add .gitignore && git commit -m "chore: ignore .env" && git push
   ```

   Después, añade `GITHUB_TOKEN=tu_token` al `.env` con tu editor.

   Para Codex, `--target codex`. Para probar una copia local del paquete, pasa su ruta en vez de `venturars/…#staging`.

3. Comprueba que están las piezas:
   - **Cursor:** `ls .agents/skills .cursor/agents` (28 skills y 9 subagentes).
   - **Codex:** `ls .agents/skills .codex/agents` (28 skills y 9 subagentes `.toml`).

4. Abre la herramienta, mejor desde el escritorio que desde la terminal: así se comprueba que no depende de las variables de la terminal. En Codex, acepta la confianza en el proyecto.

5. En el chat del agente, sigue estos pasos y comprueba el resultado de cada uno. Acepta los permisos que pida la herramienta. En Codex, llama a las skills con `$` en vez de `/`.

   | Escribe | Tiene que pasar |
   |---|---|
   | `/check-status` | `Rama base: main`, `Token de GitHub: GITHUB_TOKEN en .env`, `GitHub CLI: cuenta TU_LOGIN` y `Node: 20` o más. |
   | `/configure-models` | Una tabla con agente, modelo y motivo, y la pregunta de aceptación. Tras aceptar: 9 archivos con `model` (`grep -l "^model" .cursor/agents/* .claude/agents/* .codex/agents/*`, según la herramienta), y `/check-status` con `Modelos: configurado (cursor 9/9)`. Tras otro `apm install` indica `desincronizado`, y `/configure-models` con Enter lo restaura. Sin la CLI de la herramienta no propone ningún modelo y permite indicar uno a mano. En Codex, `codex debug models` no está verificado con un Codex real: conviene revisar la propuesta. |
   | `/setup-context7` | Una tabla con las dependencias sugeridas (y las descartadas con motivo) y la pregunta de aceptación. Tras aceptar: `context7` en la config de usuario (`~/.cursor/mcp.json`, `~/.claude.json` o `~/.codex/config.toml`), nada en las configs MCP del proyecto, y un bloque «Context7» con las librerías en `AGENTS.md` o `CLAUDE.md`. Si `docs-rag` estaba registrado, desaparece. Repetirlo no cambia nada. Sin `--with-key` no hay cabecera. Con ella, `grep -n -i context7_api_key` muestra el nombre de la variable y nunca un valor, y las `notes` explican cómo cargar el `.env` (la clave se lee de ahí). Tras recargar el editor, «¿Cómo uso useState? use context7» llama a `resolve-library-id` y luego a `query-docs`. La sintaxis de la cabecera con variable de entorno no está probada con un editor real. |
   | `/setup-docs-rag` (con Docker, Ollama y `uv`; antes, `npm i zod@3.23.8` y un `.nvmrc` con `22`) | Una tabla con `zod 3.23.8` (origen `lockfile`) y el runtime `node 22`, y la pregunta de aceptación. Tras aceptar: el contenedor `docs-rag-qdrant` en marcha, `.docs-rag/` con `app/`, `venv/`, `inventory.json` y su `.gitignore` (`git status` no lo muestra), claves en inglés en `inventory.json` y `request.json`, `docs-rag` en `.mcp.json`, `.cursor/mcp.json` y `.codex/config.toml` del proyecto con rutas relativas, y nada de `docs-rag` en la config de usuario ni en `~/.docs-rag/`. Repetirlo dice `unchanged` y no descarga nada. Tras recargar el editor, «¿Cómo valido un email con zod?» llama a `resolve_package` y luego a `query_docs`, y la respuesta trae `results` con `source`, `text` y `rerank_score`. `context7` desaparece de la config de usuario y el bloque «Context7» de `AGENTS.md` o `CLAUDE.md`. En otro repositorio sin `.docs-rag/`, ni `docs-rag` ni Context7 aparecen. Después, `/setup-context7` vuelve a poner Context7 y quita `docs-rag` de la config del proyecto (`channel: context7`). |
   | `/delivery-workflow` «Crea la issue y hazla: una función `sum(a, b)` en `sum.js` que suma dos números, con su test» | Issue #1 con la etiqueta `feat`. Rama `1-feat-…`, commit `chore: open #1`, pull request en draft con `Closes #1` y la etiqueta. Después, en la issue, `## Spec`, `## Plan` y `## Tasks` y un comentario por ronda. Al final, un commit con `sum.js` y su test, subido. |
   | Edita la parte de arriba de la issue en GitHub mientras corren las rondas | La escritura siguiente en la issue para y el agente te pregunta. |
   | «Que la revise TU_NOMBRE» | Te contesta que el autor no puede revisar su propia pull request y no pide nada. |
   | Con la PR en `CHANGES_REQUESTED`, «la PR pide cambios» | Un comentario `<!-- Revisión 1 -->` con spec, plan y tasks en la misma issue y se repite el ciclo. |

   Compruébalo también fuera del chat: `git log --oneline`, `gh issue view 1 --comments` y `gh pr view --web`.

   Para probar las consultas legales, añade a `docs/CONSTITUTION.md` la sección `## Datos personales` con sus cuatro campos rellenos ([Protección de datos](../README.md#protección-de-datos)) y ejecuta `apm install`, que escribe el MCP `eur-lex`. Después, con un gestor de versiones de Node:

   | Con | Escribe | Tiene que pasar |
   |---|---|---|
   | Node 24 | `/delivery-workflow` «Crea la issue y hazla: enviar el nombre y el correo de cada usuario a un chatbot alojado fuera del EEE» | `concept-developer` devuelve una consulta legal sobre transferencias internacionales (RGPD 44 a 49). El orquestador llama a `legal-advisor` antes de la ronda 1. La issue recibe un comentario `## Consultas legales` con la respuesta, los artículos y el CELEX `32016R0679` con la fecha. La spec recoge el requisito con `(CL-NN; RGPD …)`. |
   | Node 20 | La misma tarea, en otro repositorio desechable o en una issue nueva | El comentario de `legal-advisor` dice que no usó EUR-Lex, o la consulta queda como hueco y el orquestador te la pregunta. |

6. Anota lo que falle: la herramienta, el paso, lo que escribiste y el error. Ábrelo como issue en [este repositorio](https://github.com/venturars/delivery-workflow/issues) con el tipo `fix`.

7. Borra el repositorio de prueba: `gh auth refresh -s delete_repo` y después `gh repo delete delivery-test --yes`.

## Refrescar los textos legales

La skill `data-protection-guideline` lleva en `assets/` una copia de cada artículo que cita su checklist. Para volver a descargarlos, desde la raíz del repositorio:

```bash
node .github/scripts/refresh-legal-sources.mjs
```

El script lee `assets/sources.json` de la skill y descarga cada artículo: el RGPD consolidado del Cellar de EUR-Lex y la LOPDGDD consolidada de la API de datos abiertos del BOE. En la LOPDGDD busca cada bloque por su título («Artículo N») y guarda su última versión. Reescribe `assets/rgpd/`, `assets/lopdgdd/` y `sources.json` con la fecha de descarga de hoy. Solo usa módulos incorporados de Node y no lo reciben los proyectos.

- **Añadir un artículo:** añade su número a la norma en `sources.json` y vuelve a lanzar el comando. Cada artículo que cite el checklist tiene que estar en `sources.json`.
- **Si algo falla** (red, respuesta distinta de 200, un artículo que no aparece), el script sale con error, nombra la URL o el número y no cambia ningún fichero: escribe en una carpeta temporal y la mueve al final.
- **Opciones:** `--sources RUTA` lee otro `sources.json` y `--out CARPETA` escribe en otra carpeta.
- **Tests:** `tests/refresh-legal-sources.test.mjs` corre con `node --test tests/*.mjs` contra los fixtures de `tests/fixtures/refresh-legal-sources/`, sin red.

Revisa el diff antes de hacer commit: un cambio en el texto de un artículo puede pedir un cambio en el checklist. La versión del paquete con la guía espera a dos dudas de #56.

## Publicar una versión

Los cambios entran en `staging` por pull request desde su rama de trabajo. Para publicar:

1. Fusiona los cambios de desarrollo en `staging`. No hace falta subir `version` a mano: `release.yml` calcula el siguiente `major`, `minor` o `patch` a partir de los commits desde la última etiqueta estable cuando recibe el push a `main`.
2. Quien mantiene el paquete abre la pull request de `staging` a `main`. GitHub no inicia `release.yml` en respuesta a una PR creada con `GITHUB_TOKEN`; no cuentes con una ejecución de validación mientras la PR está abierta. En una PR desde un fork, si el workflow se ejecuta y `version` en `apm.yml` no coincide con la calculada, la persona autora debe fijarla manualmente a la versión calculada.
3. Al hacer merge, el push a `main` dispara `release.yml`. Ese workflow calcula y valida la versión en el push; si hace falta, la fija en un commit `chore: release X.Y.Z`. En ese mismo commit quita `dependencies.apm` de este repositorio, si está, para que la etiqueta no pida otro commit del mismo paquete. Después continúa con la publicación en la misma ejecución. Si la versión no supera la última estable o la etiqueta ya existe, termina sin crear la etiqueta ni la release. Si la validación pasa, crea la etiqueta `vX.Y.Z` y la release. No hace falta etiquetar a mano.

Para ver qué versión saldría: `bash .github/scripts/release-version.sh`.

La versión siguiente se calcula desde los Conventional Commits posteriores a la
última etiqueta estable. Aplica esta prioridad determinista: un `!` o
`BREAKING CHANGE` produce `major`; si no existe ninguno, un `feat` produce
`minor`; los demás cambios producen `patch`. Las reglas de los commits
seleccionan el tipo y el número; una IA no interviene en el cálculo.

Las releases estables usan etiquetas `vX.Y.Z` inmutables. Si `vX.Y.Z` ya
existe o la versión calculada no supera la última etiqueta estable, el workflow
termina sin mover, borrar ni recrear la etiqueta.

Los proyectos instalan desde la etiqueta, así que `staging` puede cambiar sin afectarles.

## Mantener este repositorio con su propia release

El workflow `APM: update dependency` solo corre en este repositorio y abre la pull request contra `staging`. La instalación de APM y `apm update` usan el token de Actions (`GITHUB_TOKEN`), para no pedir los metadatos de release de forma anónima. Cada día a las 08:17 UTC, y también a mano, elige la release estable más alta de `venturars/delivery-workflow` cuyo `apm.yml` no depende de este repositorio. Las etiquetas que sí dependen, como `v1.1.3` y `v1.1.4`, se saltan: APM no instala dos commits del mismo paquete. Si el manifiesto ya apunta a la elegida, no ejecuta `apm update`. Si apunta a una anterior, escribe la referencia nueva en `dependencies.apm` y ejecuta `apm update` para `claude`, `cursor` y `codex`. La pull request queda en la rama `chore/update-delivery-workflow` e incluye `apm.yml`, `apm.lock.yaml` y los archivos generados por APM.

No es un workflow reutilizable: otro repositorio no puede llamarlo. Tampoco se engancha al evento `release`, porque esa release la crea `GITHUB_TOKEN` y GitHub no arrancaría el workflow. La pull request la abre el mismo token, así que no dispara `review`.
