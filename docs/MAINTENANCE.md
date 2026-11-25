# Mantenimiento

Para quien cambia o publica el paquete.

## Tests del paquete

Desde la raíz del repositorio:

```bash
node --test tests/*.mjs
node --test tests/discord-pr-notifications/*.test.mjs
bash tests/scripts.test.sh
uv run --no-project --python 3.15 --with pytest --with markdownify --with beautifulsoup4 --with docutils python -m pytest -p no:cacheprovider tests/docs_rag
bash tests/apm-audit.test.sh
```

Los tests de Python cubren el paquete `docs_rag` de `/setup-docs-rag` sin red, Qdrant ni modelos; necesitan [uv](https://docs.astral.sh/uv/). `bash tests/apm-audit.test.sh` crea una copia temporal del paquete, excluye el estado local y los artefactos generados, regenera allí los artefactos APM y ejecuta `apm audit --ci`. Al terminar, elimina la copia temporal y deja intacto el checkout.

El aviso de PR de este repositorio y su acción compuesta se describen en [DISCORD-PR-NOTIFICATIONS.md](DISCORD-PR-NOTIFICATIONS.md). APM no instala workflows de GitHub en los proyectos.

La skill `setup-discord-notifications` lleva en `assets/discord-pr-notifications/` una copia de la acción de `.github/actions/discord-pr-notifications/`. Las dos deben ser idénticas: al cambiar una, copia el cambio a la otra.

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
   - **Cursor:** `ls .agents/skills .cursor/agents` (29 skills y 9 subagentes).
   - **Codex:** `ls .agents/skills .codex/agents` (29 skills y 9 subagentes `.toml`).

4. Abre la herramienta, mejor desde el escritorio que desde la terminal: así se comprueba que no depende de las variables de la terminal. En Codex, acepta la confianza en el proyecto.

5. En el chat del agente, sigue estos pasos y comprueba el resultado de cada uno. Acepta los permisos que pida la herramienta. En Codex, llama a las skills con `$` en vez de `/`.

   | Escribe | Tiene que pasar |
   |---|---|
   | `/check-status` | `Rama base: main`, `Token de GitHub: GITHUB_TOKEN en .env`, `GitHub CLI: cuenta TU_LOGIN` y `Node: 20` o más. |
   | `/configure-models` | Una tabla con agente, modelo y motivo, y la pregunta de aceptación. Tras aceptar: 9 archivos con `model` (`grep -l "^model" .cursor/agents/* .claude/agents/* .codex/agents/*`, según la herramienta), y `/check-status` con `Modelos: configurado (cursor 9/9)`. Tras otro `apm install` indica `desincronizado`, y `/configure-models` con Enter lo restaura. Sin la CLI de la herramienta no propone ningún modelo y permite indicar uno a mano. En Codex, `codex debug models` no está verificado con un Codex real: conviene revisar la propuesta. |
   | `/setup-context7` | Una tabla con las dependencias sugeridas (y las descartadas con motivo) y la pregunta de aceptación. Tras aceptar: `context7` en la config de usuario (`~/.cursor/mcp.json`, `~/.claude.json` o `~/.codex/config.toml`), nada en las configs MCP del proyecto, y un bloque «Context7» con las librerías en `AGENTS.md` o `CLAUDE.md`. Si `docs-rag` estaba registrado, desaparece. Repetirlo no cambia nada. Sin `--with-key` no hay cabecera. Con ella, `grep -n -i context7_api_key` muestra el nombre de la variable y nunca un valor, y las `notes` explican cómo cargar el `.env` (la clave se lee de ahí). Tras recargar el editor, «¿Cómo uso useState? use context7» llama a `resolve-library-id` y luego a `query-docs`. La sintaxis de la cabecera con variable de entorno no está probada con un editor real. |
   | `/setup-docs-rag` (con Docker, Ollama y `uv`; antes, `npm i zod@3.23.8` y un `.nvmrc` con `22`) | Una tabla con `zod 3.23.8` (origen `lockfile`) y el runtime `node 22`, y la pregunta de aceptación. Tras aceptar: el contenedor `docs-rag-qdrant` en marcha, `.docs-rag/` con `app/`, `venv/`, `inventory.json` y su `.gitignore` (`git status` no lo muestra), claves en inglés en `inventory.json` y `request.json`, `docs-rag` en `.mcp.json`, `.cursor/mcp.json` y `.codex/config.toml` del proyecto con rutas relativas, y nada de `docs-rag` en la config de usuario ni en `~/.docs-rag/`. Repetirlo dice `unchanged` y no descarga nada. Tras recargar el editor, «¿Cómo valido un email con zod?» llama a `resolve_package` y luego a `query_docs`, y la respuesta trae `results` con `source`, `text` y `rerank_score`. `context7` desaparece de la config de usuario y el bloque «Context7» de `AGENTS.md` o `CLAUDE.md`. En otro repositorio sin `.docs-rag/`, ni `docs-rag` ni Context7 aparecen. Después, `/setup-context7` vuelve a poner Context7 y quita `docs-rag` de la config del proyecto (`channel: context7`). |
   | `/setup-discord-notifications`, con un servidor de Discord tuyo y un repositorio desechable, con la rama `staging` además de la predeterminada, donde instalas el paquete con `apm install`, con `GITHUB_TOKEN` con permiso de administración en el `.env`, y la skill lanzada desde un agente | Sin bot previo, la guía del paso 0 te lleva a crear la aplicación y el bot, copiar el token al `.env` sin pasarlo por el chat, invitar el bot con el enlace `scope=bot` y `permissions=3072` y copiar los IDs. `verify` con datos correctos da `ok: true` y `correcto` en `token`, `servidor` y `canal`; con un fallo provocado (un ID de canal de otro servidor, o un token alterado) da `ok: false`, el `reason` de ese motivo y código de salida 6, y la skill no sigue con `apply`. `apply` crea los tres workflows y la acción en `.github/` con la marca en la primera línea, y el entorno `discord-pr-notifications` con sus dos secretos y sus dos variables (`gh secret list --env discord-pr-notifications`); el token no aparece en el chat. Con `staging` como rama base, los recordatorios finales dicen que los workflows van en la rama predeterminada y también en `staging`, y que el commit y el merge son tuyos. El agente informa además de las menciones: cuándo hace falta mapear, la variable `DISCORD_USER_MAP` y el comentario `/discord-map`, sin preguntar sus valores ni crearla (`gh variable list --env discord-pr-notifications` no la muestra). Tras commit y merge a las dos ramas, los tres workflows están en ambas (`git ls-tree --name-only origin/RAMA .github/workflows/`, una vez por rama, después de `git fetch`) y una PR hacia `staging`, fuera de draft y con un revisor pedido, da un aviso en Discord, una sola vez. **`/discord-map`**: con un revisor cuyo nombre de usuario de Discord difiera de su login, el primer aviso sale «sin mención de Discord»; un comentario `/discord-map LOGIN ID` en esa PR da un segundo aviso que menciona solo a esa persona. **Comprobación de D-16**: con el bot invitado y los «Privileged Gateway Intents» desactivados, el aviso menciona a un revisor pedido que sea miembro del servidor y cuyo nombre de usuario de Discord coincida con su login de GitHub, o cuya relación esté confirmada con `/discord-map LOGIN ID` en un comentario de la PR. Si el revisor no cumple eso, la ausencia de mención no es un fallo de la skill ni del intent: usa un revisor que lo cumpla o confirma la relación. Solo si falta la mención con un revisor que lo cumple, activa el «Server Members Intent», repite y corrige la skill para pedirlo. Un segundo `apply` da `igual` en los ficheros, el entorno, las variables y `DISCORD_CACHE_KEY`, y `actualizado` en `DISCORD_BOT_TOKEN` si sigue en el `.env` (`conservado` si ya no está y el secreto existe); con un fichero editado, `conservado`. `reset` quita los ficheros sin tocar el entorno y `reset --remove-environment` lo borra. Con un token sin permiso de administración, la skill dice «403» y remite a los pasos manuales de `docs/DISCORD-PR-NOTIFICATIONS.md`. |
   | `/setup-compliance` (antes, `npm i openai`) | Una tabla con la señal `openai` (fuente `package.json`), los seis documentos `ausente` y los propuestos: `ai-act`, `dpia`, `security` y `system-card`, sin `model-card` ni `data-card`. Después, la entrevista en tandas con una respuesta recomendada por pregunta y la confirmación de la lista. Tras aceptar: `docs/ai-act.md`, `docs/dpia.md`, `docs/security.md` y `docs/system-card.md`, cada uno con la marca `<!-- setup-compliance sha256=… -->` en la primera línea, una fuente por afirmación, los huecos como `> **Hueco:**` y la línea «Documento orientativo: no certifica cumplimiento ni es asesoramiento jurídico.» al final; `grep -ril cumple docs/` no encuentra nada. La tabla final trae documento, ruta, resultado `creado` y número de huecos. Edita a mano `docs/dpia.md` y repite la orden: la skill avisa de que no lo tocará, la tabla dice `conservado` para `dpia` e `igual` o `actualizado` para el resto, y `docs/dpia.md` conserva tu edición. `docs/CONSTITUTION.md` no cambia. |
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

   Abre una sesión nueva con el sandbox activo en cada herramienta. El repositorio configura el sandbox en `.claude/settings.json` (`sandbox.network.allowedDomains`) y en `.cursor/sandbox.json` (`networkPolicy.allow`), con `api.github.com` y `github.com` en los dos. El repositorio no activa el sandbox. En Claude Code, actívalo con `/sandbox`.

   **Cursor.** Según la [documentación de Cursor](https://cursor.com/docs/reference/sandbox), el `allow` del proyecto se une con el de usuario.

   **Claude Code.** Según la [documentación de Claude Code](https://code.claude.com/docs/en/sandboxing), el sandbox cubre los comandos de shell. `gh` es un comando de shell.

   En Claude Code y en Cursor, escribe estos comandos:

   | Con | Escribe | Tiene que pasar |
   |---|---|---|
   | Claude Code | `bash .claude/skills/check-status/scripts/check-status.sh` | La línea `GitHub CLI` dice `cuenta TU_LOGIN`, no «GitHub rechaza el token del .env». |
   | Claude Code | `curl -sS -m 10 https://example.com` | El sandbox bloquea la conexión. |
   | Cursor | `bash .claude/skills/check-status/scripts/check-status.sh` | La línea `GitHub CLI` dice `cuenta TU_LOGIN`. |
   | Cursor | `curl -sS -m 10 https://example.com` | El sandbox bloquea la conexión. |

   Si `example.com` pasa, el sandbox no está actuando y la prueba falla. Si `check-status.sh` dice que GitHub rechaza el token, puede que la configuración del proyecto no surta efecto; un token inválido da el mismo mensaje. La prueba falla. En los dos casos, anota en la issue la herramienta y su versión.

   Para Codex, `.codex/config.toml` define el perfil `github-net` y lo activa con `default_permissions`. Según la [documentación de permisos de Codex](https://learn.chatgpt.com/docs/permissions.md), un perfil puede extender otro con `extends`, y si `sandbox_mode` aparece en una configuración cargada, Codex usa los ajustes antiguos en vez del perfil. La documentación no dice qué lee `:workspace` ni si equivale a `workspace-write`: la comparación lo comprueba.

   Marca el proyecto como de confianza y abre dos sesiones nuevas de Codex, una sin perfil y otra con él. Haz las mismas nueve pruebas en las dos:

   - **Sin perfil:** otro `CODEX_HOME` no quita el perfil, porque con el proyecto de confianza Codex carga el `.codex/config.toml` del repositorio. Copia el repositorio a un directorio temporal fuera de la carpeta del proyecto y sustituye en la copia `.codex/config.toml` por la versión de `staging` (`git show staging:.codex/config.toml > RUTA_COPIA/.codex/config.toml`). Marca la copia como proyecto de confianza en un `CODEX_HOME` temporal y abre Codex ahí. No edites el fichero versionado.
   - **Con perfil:** abre Codex en el repositorio tal cual, con su `.codex/config.toml`.

   | Prueba | Escribe | Tiene que pasar |
   |---|---|---|
   | 1. Crear en el repo | `touch prueba-sandbox.txt` | Mismo código de salida con y sin perfil. Borra el fichero después. |
   | 2. Escribir fuera del repo | `touch ../prueba-sandbox.txt` | Mismo código de salida con y sin perfil. |
   | 3. Leer la config personal | `head -c 1 ~/.codex/config.toml > /dev/null` | Mismo código de salida con y sin perfil. El comando no muestra tu configuración. |
   | 4. Listar el directorio personal | `ls ~` | Mismo código de salida con y sin perfil. |
   | 5. `gh` en el `PATH` | `echo $PATH` y `command -v gh` | `gh` aparece en el `PATH` con perfil. |
   | 6. GitHub responde | `curl -sS -m 10 https://api.github.com/zen` | Con perfil, responde con una frase. |
   | 7. Dominio fuera de la lista | `curl -sS -m 10 https://example.com` | Con perfil, el sandbox bloquea la conexión. |
   | 8. Sesión de `gh` | `gh auth status` | Con perfil, `gh` llega a GitHub y no falla por la red. |
   | 9. `check-status` | `bash .claude/skills/check-status/scripts/check-status.sh` | Con perfil, la línea `GitHub CLI` dice `cuenta TU_LOGIN`. |

   La prueba pasa si las pruebas 1 a 4 dan los mismos códigos en las dos sesiones, `gh` está en el `PATH` (prueba 5), GitHub responde (pruebas 6, 8 y 9) y `example.com` queda bloqueado (prueba 7). La prueba falla en estos casos:

   - Hay una diferencia en ficheros o en el `PATH` entre las dos sesiones.
   - Al arrancar con el perfil aparece «default_permissions requires a [permissions] table». Codex ignora el perfil.

   Haz dos comprobaciones más:

   - **`sandbox_mode` personal:** repite las nueve pruebas con perfil. Añade `sandbox_mode = "workspace-write"` a tu `~/.codex/config.toml` y anota si el perfil sigue aplicándose: `api.github.com` responde y `example.com` queda bloqueado. Si Codex ignora `default_permissions` por `sandbox_mode`, la prueba falla. Quita la línea al terminar.
   - **Proyecto sin confianza:** abre Codex con el proyecto sin marcar como de confianza. Comprueba que avisa de que ignora la configuración del proyecto y que `curl -sS -m 10 https://api.github.com/zen` no pasa por el perfil. Anota el texto del aviso en la issue. El aviso sale de la observación de una prueba, no de la documentación: la documentación dice solo que Codex carga la configuración del proyecto cuando el proyecto es de confianza. Es el comportamiento esperado, no un fallo del perfil.

   Si algo falla en Codex, anota en la issue la herramienta, su versión (`codex --version`), la prueba y el mensaje de error. Si una herramienta no se puede probar, anótalo en la issue y no la des por probada.

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

### Textos del Reglamento de IA

La skill `setup-compliance` lleva en `assets/reglamento-ia/` el texto oficial en español de los arts. 5, 6 y 50 y del anexo III del Reglamento (UE) 2024/1689 (CELEX `32024R1689`), en su texto consolidado vigente (hoy `02024R1689-20260727`, con el Reglamento (UE) 2026/1744). Antes de refrescarlos, mira en EUR-Lex si hay una consolidada más nueva (`eurlex_get_relations` con `consolidated_version`). `refresh-legal-sources.mjs` no los refresca: se descargan a mano del Cellar de EUR-Lex (`http://publications.europa.eu/resource/celex/02024R1689-20260727`, con `Accept: application/xhtml+xml` y `Accept-Language: spa`) y se convierten a Markdown sin cambiar el texto. Cada fichero lleva su fecha de descarga. Si cambia un artículo, revisa el paso que lo cita en `assets/ai-act-classification.md`.

## Publicar una versión

Los cambios entran en `staging` por pull request desde su rama de trabajo. Para publicar:

1. Fusiona los cambios de desarrollo en `staging`.
2. Quien mantiene el paquete abre la pull request de `staging` a `main` y la fusiona.
3. El push a `main` dispara `release-create-version.yml` («Release: create version»). El workflow busca la última etiqueta `vX.Y.Z`, reúne los commits y los ficheros cambiados desde ella y se los envía a la IA de Groq. La IA decide si el cambio es `major`, `minor` o `patch` y escribe el resumen. El workflow calcula la versión nueva, crea la etiqueta y la release con ese resumen y la lista de PR. No hace falta etiquetar a mano. Si el commit ya tiene etiqueta, no crea otra.

El workflow necesita el secreto `GROQ_API_KEY` en el repositorio. Si falta, si la IA no responde o si su respuesta no es válida, el workflow falla y no crea etiqueta ni release.

El workflow no cambia `version` en `apm.yml` ni hace commits en `main`: la versión publicada es la etiqueta.

Las releases estables usan etiquetas `vX.Y.Z`. Una IA decide el tipo de cambio, así que dos ejecuciones sobre los mismos commits pueden dar un resumen distinto.

Los proyectos instalan desde la etiqueta, así que `staging` puede cambiar sin afectarles.

## Mantener este repositorio con su propia release

El workflow `APM: update dependency` solo corre en este repositorio. Hace checkout de `staging` y abre la pull request contra esa rama. La instalación de APM y `apm update` usan el token de Actions (`GITHUB_TOKEN`), para no pedir los metadatos de release de forma anónima. El instalador no añade su directorio al PATH cuando detecta CI; el paso lo publica en `GITHUB_PATH`. Cada día a las 08:17 UTC, y también a mano, elige la release estable más alta de `venturars/delivery-workflow` cuyo `apm.yml` no depende de este repositorio. Las etiquetas que sí dependen, como `v1.1.3` y `v1.1.4`, se saltan: APM no instala dos commits del mismo paquete. Si el manifiesto ya apunta a la elegida, no ejecuta `apm update`. Si apunta a una anterior, o el commit de release quitó `dependencies.apm`, escribe esa entrada con la referencia nueva y ejecuta `apm update --force` para `claude`, `cursor` y `codex`. `--force` hace falta porque el runner no guarda recibos de despliegue y el paquete local (`.apm/`) publica los mismos ficheros que la dependencia: sin esa opción, APM 0.38 rechaza la escritura con `no trustworthy local deployment baseline` y no mueve el lock. La pull request se abre en draft, queda en la rama `chore/update-delivery-workflow` e incluye `apm.yml`, `apm.lock.yaml` y los archivos generados por APM.

No es un workflow reutilizable: otro repositorio no puede llamarlo. Tampoco se engancha al evento `release`, porque esa release la crea `GITHUB_TOKEN` y GitHub no arrancaría el workflow. La pull request la abre el mismo token, así que no dispara `PR: check rules`.
