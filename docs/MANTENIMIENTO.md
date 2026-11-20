# Mantenimiento

Para quien cambia o publica el paquete.

## Tests del paquete

Desde la raíz del repositorio:

```bash
node --test tests/*.mjs
node --test tests/discord-pr-notifications/*.test.mjs
bash tests/scripts.test.sh
apm audit --ci
```

El audit comprueba la integridad de los archivos del paquete.

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
   - **Cursor:** `ls .agents/skills .cursor/agents` (23 skills y 9 subagentes).
   - **Codex:** `ls .agents/skills .codex/agents` (23 skills y 9 subagentes `.toml`).

4. Abre la herramienta, mejor desde el escritorio que desde la terminal: así se comprueba que no depende de las variables de la terminal. En Codex, acepta la confianza en el proyecto.

5. En el chat del agente, sigue estos pasos y comprueba el resultado de cada uno. Acepta los permisos que pida la herramienta. En Codex, llama a las skills con `$` en vez de `/`.

   | Escribe | Tiene que pasar |
   |---|---|
   | `/check-status` | `Rama base: main`, `Token de GitHub: GITHUB_TOKEN en .env`, `GitHub CLI: cuenta TU_LOGIN` y `Node: 20` o más. |
   | `/configure-models` | Una tabla con agente, modelo y motivo, y la pregunta de aceptación. Tras aceptar: 9 archivos con `model` (`grep -l "^model" .cursor/agents/* .claude/agents/* .codex/agents/*`, según la herramienta), y `/check-status` con `Modelos: configurado (cursor 9/9)`. Tras otro `apm install` indica `desincronizado`, y `/configure-models` con Enter lo restaura. Sin la CLI de la herramienta no propone ningún modelo y permite indicar uno a mano. En Codex, `codex debug models` no está verificado con un Codex real: conviene revisar la propuesta. |
   | `/setup-context7` | Una tabla con las dependencias sugeridas (y las descartadas con motivo) y la pregunta de aceptación. Tras aceptar: `.cursor/mcp.json`, `.mcp.json` o `.codex/config.toml` con `context7`, y un bloque «Context7» con las librerías en `AGENTS.md` o `CLAUDE.md`. Repetirlo no cambia nada. Sin `--with-key` no hay cabecera. Con ella, `grep -n -i context7_api_key` muestra el nombre de la variable y nunca un valor, y las `notes` explican cómo cargar el `.env` (la clave se lee de ahí). Tras recargar el editor, «¿Cómo uso useState? use context7» llama a `resolve-library-id` y luego a `query-docs`. La sintaxis de la cabecera con variable de entorno no está probada con un editor real. |
   | `/setup-eur-lex`, con otro MCP ya configurado | Una tabla con herramienta, fichero y `result`. `.mcp.json`, `.cursor/mcp.json` o `.codex/config.toml` traen `eur-lex` con `@cyanheads/eur-lex-mcp-server@0.21.0`, y el otro MCP sigue igual. Repetirlo da `igual`. Con Node anterior a 24, escribe la configuración y lo avisa en `notes`. |
   | `/delivery-workflow` «Crea la issue y hazla: una función `sum(a, b)` en `sum.js` que suma dos números, con su test» | Issue #1 con la etiqueta `feat`. Rama `1-feat-…`, commit `chore: open #1`, pull request en draft con `Closes #1` y la etiqueta. Después, en la issue, `## Spec`, `## Plan` y `## Tasks` y un comentario por ronda. Al final, un commit con `sum.js` y su test, subido. |
   | Edita la parte de arriba de la issue en GitHub mientras corren las rondas | La escritura siguiente en la issue para y el agente te pregunta. |
   | «Que la revise TU_NOMBRE» | Te contesta que el autor no puede revisar su propia pull request y no pide nada. |
   | Con la PR en `CHANGES_REQUESTED`, «la PR pide cambios» | Un comentario `<!-- Revisión 1 -->` con spec, plan y tasks en la misma issue y se repite el ciclo. |

   Compruébalo también fuera del chat: `git log --oneline`, `gh issue view 1 --comments` y `gh pr view --web`.

   Para probar las consultas legales, añade a `docs/CONSTITUTION.md` la sección `## Datos personales` con sus cuatro campos rellenos ([Protección de datos](../README.md#protección-de-datos)) y ejecuta `/setup-eur-lex`. Después, con un gestor de versiones de Node:

   | Con | Escribe | Tiene que pasar |
   |---|---|---|
   | Node 24 | `/delivery-workflow` «Crea la issue y hazla: enviar el nombre y el correo de cada usuario a un chatbot alojado fuera del EEE» | `concept-developer` devuelve una consulta legal sobre transferencias internacionales (RGPD 44 a 49). El orquestador llama a `legal-advisor` antes de la ronda 1. La issue recibe un comentario `## Consultas legales` con la respuesta, los artículos y el CELEX `32016R0679` con la fecha. La spec recoge el requisito con `(CL-NN; RGPD …)`. La ronda siguiente es la 1. |
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

Revisa el diff antes de hacer commit: un cambio en el texto de un artículo puede pedir un cambio en el checklist. La versión del paquete con la guía espera a dos dudas de #56 ([ADR 0013](adr/0013-guia-de-proteccion-de-datos.md)).

## Publicar una versión

Los cambios entran en `staging` por pull request desde su rama de trabajo. Para publicar:

1. En `staging`, sube `version` en `apm.yml` con un commit `chore: release X.Y.Z`, por pull request como cualquier otro cambio. Quien prepara la versión elige el número.
2. Abre la pull request de `staging` a `main`. La comprobación *Comprobar la versión* falla si `vX.Y.Z` ya existe o es menor que la última etiqueta.
3. Al hacer merge, el workflow `.github/workflows/release.yml` crea la etiqueta `vX.Y.Z` en ese commit de `main` y la release con las notas que genera GitHub. No hace falta etiquetar a mano.

Para ver qué versión saldría: `bash .github/scripts/release-version.sh`.

Los proyectos instalan desde la etiqueta, así que `staging` puede cambiar sin afectarles ([ADR 0006](adr/0006-el-paquete-vive-en-su-propio-repositorio.md), [ADR 0008](adr/0008-la-version-de-apm-yml-crea-la-etiqueta.md)).
