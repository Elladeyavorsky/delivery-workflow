# Modelos de los agentes

Cada agente del paquete puede correr con un modelo distinto: uno potente para el que escribe la spec y uno ligero para el que solo lanza un script. Como cada persona tiene otra suscripción, el modelo no viene en el paquete: lo elige cada una con `/configure-models`. Si no haces nada, los agentes usan el modelo de tu chat y todo funciona igual.

Por ahora solo funciona con **Cursor**. Claude Code y Codex llegan después.

## Cómo se usa

1. `apm install` (o `apm update`).
2. `/configure-models` (en Codex, `$configure-models`). Lee los modelos de tu cuenta, propone uno por agente con el motivo y pregunta una vez: «¿Los aceptas? [Enter = sí | nombre del agente para cambiarlo]».
3. Con `--yes` acepta la propuesta sin preguntar.

Las elecciones se guardan en `.git/delivery-workflow-models.json`, dentro de `.git`: son tuyas y git no las ve.

## Niveles

Cada agente tiene un nivel y cada herramienta decide qué modelo de los que tienes encaja con cada nivel. Todo está en [agent-profiles.json](../.apm/skills/configure-models/assets/agent-profiles.json): cambiar el criterio es cambiar ese fichero.

| Agente | Nivel | Por qué |
|---|---|---|
| `concept-developer` | pesado | Escribe la spec y el plan: un fallo se repite en todas las rondas. |
| `code-developer` | estándar | Escribe código a partir de una spec clara. |
| `code-tester` | estándar | Convierte los escenarios de la spec en tests. |
| `concept-tester` | estándar | Compara la documentación con el código en cada ronda: un modelo débil da falsos aprobados. |
| `create-issue`, `create-pr` | ligero | Rellenan una plantilla y lanzan scripts. |
| `create-branch`, `create-commit` | ligero | Uno o dos scripts, sin criterio. |

Para cada nivel, el perfil de la herramienta lista patrones por orden y gana el primero que coincide con un modelo que tengas. Si ninguno coincide, el agente hereda el modelo del chat.

## Cambiar el modelo de un agente

- Vuelve a ejecutar `/configure-models` y contesta con el nombre del agente. Escribe el modelo que quieras: uno de la lista o uno a mano. Enter deja el agente sin modelo (hereda el del chat).
- A mano, sin la skill: `node .agents/skills/configure-models/scripts/configure-models.mjs apply --set code-developer=NOMBRE`. `--set agente=inherit` lo deja sin modelo.
- Para quitarlo todo: `node .agents/skills/configure-models/scripts/configure-models.mjs reset`.

Si no tienes la CLI de Cursor (`cursor-agent`), no hay lista de modelos: todos los agentes heredan el del chat hasta que escribas uno a mano. El nombre tiene que ser exactamente el que Cursor da al modelo, tal como sale en `cursor-agent models`, sin variantes entre corchetes.

## Después de `apm install` o `apm update`

`apm install` vuelve a copiar los agentes y **borra la línea `model` sin avisar**. Se comprobó con `apm` 0.35.0: una línea añadida a mano a un agente desplegado desaparece en el siguiente `apm install`, y con `--update` también. Por eso:

- `check-status` muestra `Modelos: desincronizado (cursor 0/8)` hasta que vuelvas a aplicarlas.
- `/configure-models` empieza por lo guardado, así que aceptar con Enter (o `--yes`) restaura tus elecciones sin volver a pensarlas. Un guardado sigue valiendo si el modelo continúa en la lista actual; si no se pudo leer la lista (por ejemplo, no está la CLI), se confía en él por si lo escribiste a mano.
- Sin la skill: `node .agents/skills/configure-models/scripts/configure-models.mjs apply` vuelve a poner lo guardado, sin preguntar nada.

`apm audit` marcará esos agentes como editados, porque el lockfile guarda el hash de cada archivo desplegado y la línea `model` lo cambia. Es lo esperado.

### Automatizarlo (no forma parte de esta versión)

APM puede ejecutar un script después de cada instalación si la persona lo declara y lo confía en su `apm.yml`. En una prueba con `apm` 0.35.0, esto dejó `Modelos: configurado (cursor 8/8)` justo después de `apm install`:

```yaml
lifecycle:
  post-install:
    - type: command
      description: Volver a poner los modelos guardados
      command: node .agents/skills/configure-models/scripts/configure-models.mjs apply
      timeoutSec: 30
```

Después hay que ejecutar una vez `apm lifecycle trust`. Se deja fuera porque ese bloque corre comandos arbitrarios en cada instalación y cada persona tiene que decidir si lo confía.

## Por qué las líneas de modelo no se suben a git

El modelo depende de tu suscripción. Si la línea `model: X` llegara al repositorio, quien no tenga `X` tendría agentes con un modelo que Cursor no puede usar. Y las herramientas de cada persona se suelen subir al repositorio. Por eso los archivos de los agentes del paquete se tratan como lo que son, resultado de una instalación, y no se suben: [decisión 0008](adr/0008-los-modelos-son-personales.md).

`/configure-models` ofrece añadir al `.gitignore` los 8 archivos del paquete, uno a uno (no la carpeta `agents/`, para que tus propios agentes sigan subiéndose). Si lo ejecutas dos veces no duplica nada.

### Si el proyecto ya sube esos archivos

`.gitignore` no hace nada con un archivo que git ya sigue. Si `/configure-models` detecta que alguno está seguido, lo avisa y te escribe el comando. Ejecútalo tú, una sola vez:

```bash
git rm --cached ".cursor/agents/code-developer.md" ...
```

El script nunca lo ejecuta. Haz commit del cambio; los archivos siguen en tu disco.

## Qué hay que saber de Cursor

Comprobado en una cuenta Plus con `cursor-agent` 2026.11.11:

- **El nombre de `cursor-agent models` vale en el frontmatter.** Un agente con `model: grok-4.7-medium` ejecutó ese modelo. Para comprobarlo en tu cuenta: `cursor-agent -p --trust --output-format stream-json "Usa el subagente X"` y busca en la salida la llamada `taskToolCall`, que lleva el `model` y el resultado.
- **Un nombre que Cursor no conoce no da error.** El subagente corre con el modelo del chat, y la única pista es una nota en el resultado («is not available, so it ran on …»). Por eso se pide el nombre exacto de la lista.
- **La lista incluye modelos que tu plan no permite.** `grok-4.7-low` y `grok-4.7-low-fast` salían en `cursor-agent models` y fallaron como subagente («Model unavailable on Plus»). `grok-4.7-high` también salía y Cursor lo rechazó como subagente, con una lista más corta de modelos permitidos. Un administrador Enterprise puede bloquear otros. Los patrones del perfil prefieren los que sí funcionaron (`grok-4.7-medium`, `composer-2.5`), y el paso de confirmar existe por esto. Si un agente falla por el modelo, cámbialo.
- **`cursor-agent` antiguo no sirve.** Una versión de 2025 no tenía el subcomando `models` y lo trató como una orden para el agente. El script lo ejecuta en una carpeta vacía, con límite de 10 segundos, y solo se fía de una salida que empiece por «Available models».
- **`agent`** es un nombre genérico y puede ser otro programa. Se prueba `cursor-agent` primero, y `agent` solo si no existe.
- **Fallo conocido del IDE.** Hay informes de que Cursor ignora a veces `model` en el frontmatter. Aquí solo se comprobó desde la CLI; en el IDE, mira en la propia herramienta qué modelo usó el subagente.
- **Tiempo.** Cada comando externo tiene 10 segundos. Si no responde (por ejemplo, falta iniciar sesión), el resultado es «desconocido» y los agentes heredan.

## Pendiente

- Claude Code: `claude auth status` y `availableModels`, con alias (`opus`, `sonnet`, `haiku`). Hay que probar si `CLAUDE_CODE_SUBAGENT_MODEL` pisa el modelo del frontmatter.
- Codex: `codex debug models` y la clave `model` de los `.toml`.
- Esfuerzo de razonamiento, instalaciones globales y presets de coste: fuera de alcance.
