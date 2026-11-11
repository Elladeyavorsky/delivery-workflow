# Modelos de los agentes

Cada agente puede correr con un modelo distinto: uno potente para el que escribe la spec, uno ligero para el que lanza un script. Como cada persona tiene otra suscripción, el modelo no viene en el paquete: lo eliges con `/configure-models` (en Codex, `$configure-models`). Si no haces nada, los agentes usan el modelo de tu chat y todo funciona.

Funciona con **Cursor, Claude Code y Codex**, en las que tengan carpeta de agentes en el proyecto.

## Cómo se usa

1. `apm install` (o `apm update`).
2. `/configure-models`: detecta tus modelos, propone uno por agente con el motivo y pregunta una vez «¿Los aceptas? [Enter = sí | nombre del agente para cambiarlo]». Con `--yes` acepta sin preguntar.
3. Para cambiar uno, contesta con el nombre del agente y escribe el modelo (de la lista o a mano). Enter = sin modelo (hereda el del chat).

Las elecciones se guardan en `.git/delivery-workflow-models.json`: son tuyas y git no las ve. Sin la skill, desde la raíz del proyecto (la carpeta es `.claude/skills` en Claude Code y `.agents/skills` en Cursor y Codex):

```bash
node .agents/skills/configure-models/scripts/configure-models.mjs apply --set code-developer=NOMBRE   # inherit = sin modelo
node .agents/skills/configure-models/scripts/configure-models.mjs reset                                # quita todo
```

## Niveles

Cada agente tiene un nivel y cada herramienta elige, de lo que tienes, el modelo que encaja. Todo está en [agent-profiles.json](../.apm/skills/configure-models/assets/agent-profiles.json): para cambiar el criterio, edita ese archivo (gana el primer patrón que coincide).

| Agente | Nivel | Por qué |
|---|---|---|
| `concept-developer` | pesado | Escribe la spec y el plan: un fallo se repite en todas las rondas. |
| `code-developer`, `code-tester`, `concept-tester` | estándar | Escriben código y tests, y comparan docs con código: un modelo débil da falsos aprobados. |
| `create-issue`, `create-pr`, `create-branch`, `create-commit` | ligero | Rellenan una plantilla o lanzan uno o dos scripts. |

## Después de `apm install` o `apm update`

`apm install` borra la línea `model` de los agentes sin avisar (comprobado con `apm` 0.35.0 en las tres herramientas). Por eso:

- `check-status` muestra `Modelos: desincronizado (cursor 0/8)`.
- `/configure-models` empieza por lo guardado: Enter (o `--yes`) lo restaura. Sin la skill, `apply` sin argumentos lo hace sin preguntar. Un guardado vale si el modelo sigue en la lista actual, o si no se pudo leer la lista (puede ser uno escrito a mano).
- `apm audit` marcará esos agentes como editados. Es lo esperado.

**Automatizarlo (no incluido):** tras `apm lifecycle trust`, un bloque `lifecycle: post-install` en tu `apm.yml` con el comando `apply` lo hizo solo en una prueba. Se deja fuera porque ese bloque ejecuta comandos en cada instalación y cada persona debe decidir si lo confía.

## Por qué no se suben a git

El modelo depende de tu suscripción: subido, a quien no lo tenga le daría un agente roto. Por eso los 8 archivos de agentes del paquete se tratan como resultado de la instalación ([decisión 0008](adr/0008-los-modelos-son-personales.md)). `/configure-models` ofrece ponerlos en el `.gitignore`, uno a uno (no la carpeta `agents/`, para que tus propios agentes se sigan subiendo), sin duplicar.

**Si tu proyecto ya los sube**, `.gitignore` no basta. `/configure-models` te avisa y escribe el comando; ejecútalo tú una vez y haz commit (nunca lo ejecuta él):

```bash
git rm --cached ".cursor/agents/code-developer.md" ...
```

## Qué hay que saber de cada herramienta

**Cursor** (probado con `cursor-agent` 2026.11.11, plan Plus)
- Lista: `cursor-agent models` (si no existe, `agent`). Sin la CLI no hay lista: escribe el modelo a mano.
- El nombre exacto de la lista vale en el frontmatter (`grok-4.7-medium` corrió como tal). Un nombre desconocido **no da error**: corre con el modelo del chat y solo deja una nota en el resultado.
- La lista incluye modelos que tu plan no permite (`grok-4.7-low`, `grok-4.7-high` fallaron como subagente). Los patrones prefieren los que funcionaron. Un administrador Enterprise puede bloquear más.
- Un `cursor-agent` de 2025 trata `models` como una orden al agente: se ejecuta en una carpeta vacía, con 10 s de límite, y solo se acepta una salida que empiece por «Available models».
- Hay informes de que el IDE ignora `model` a veces. Aquí solo se probó la CLI; en el IDE, mira qué modelo usó el subagente.
- Para comprobar un agente: `cursor-agent -p --trust --output-format stream-json "Usa el subagente X"` y mira `model` en la llamada `taskToolCall`.

**Claude Code** (probado con 2.1.322, plan Pro)
- No hay comando que liste modelos: se ofrecen los alias `opus`, `sonnet` y `haiku` si `claude auth status` muestra una sesión, limitados por `availableModels` de tus ajustes si lo defines. Un nombre completo (`claude-opus-…`) también vale, escrito a mano.
- Los alias valen en el frontmatter: el resultado de `claude -p --output-format stream-json --verbose` lista en `modelUsage` los modelos usados.
- Un nombre desconocido **sí falla** (error 404 al llamar al agente).
- `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` **no pisó** `model: opus` del frontmatter en esa versión.

**Codex** (**no probado con un Codex real**: no estaba instalado)
- Lista: `codex debug models`, y si falla `~/.codex/models_cache.json` (o `$CODEX_HOME`). El lector acepta una lista o un objeto con `models` y entiende `slug`, `id` o `model`; los fixtures de los tests están hechos a mano, y los patrones de nivel (`gpt-N-codex`, `…-mini`) son una suposición. Revisa la propuesta antes de aceptarla.
- Se escribe `model = "…"` en `.codex/agents/<agente>.toml`, tras `name`. Es lo que Codex lee como modelo del agente, según su documentación, sin comprobarlo.

Cada comando externo tiene 10 s de límite: si no responde (por ejemplo, falta iniciar sesión), el resultado es «desconocido» y los agentes heredan.

## Fuera de alcance

Esfuerzo de razonamiento, instalaciones globales (`~/.claude`…) y presets de coste.
