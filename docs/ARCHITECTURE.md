# Mapa de capas

Estas rutas son la única referencia válida para ubicar archivos. El mapa se adapta al árbol que ya hay; no reorganiza carpetas.

El repositorio es un paquete APM (skills y agentes) más la automatización de GitHub de este mismo repo. La intensidad es ligera en todas las partes: hay reglas de negocio, pero viven en los mismos scripts que el I/O; no hay capa de dominio extraída. El módulo pasa a completa si se extrae un dominio propio (R-GEN-05).

## Parte: automatización GitHub

Ruta: `.github/`. Workflows, scripts de release y de comprobación de pull requests, y la acción de avisos de Discord de este repositorio.

### Mapa de capas

| Rol | Ruta o glob | Notas |
| --- | --- | --- |
| Presentación | `.github/workflows/*.yml`, `.github/scripts/review-pull-request.mjs`, `.github/actions/discord-pr-notifications/` | Recibe eventos de GitHub, valida la forma de la PR y traduce al protocolo del check o del aviso. |
| Servicios (aplicación + dominio) | `.github/scripts/self-release.py`, `.github/scripts/release-version.sh`, `.github/scripts/release-ia.sh` | Reglas de manifiesto APM, versión y autodependencia. Ligera: sin capa de dominio propia. |
| Infraestructura | Llamadas a `git`, `gh` y a la API de Groq desde los workflows y scripts | No hay repositorios de persistencia. |
| Shared | — | No hay shared propio de esta parte. |
| Platform | `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` | Acciones de GitHub fijadas a SHA. |
| Raíz de composición | `.github/workflows/*.yml` | El workflow crea el entorno y llama a los scripts. |
| Pruebas | `tests/self-release.test.mjs`, `tests/review-pull-request.test.mjs`, `tests/discord-pr-notifications/` | Junto a `tests/`, no junto al script. |

### Módulos

- Cómo se reconoce un módulo: un script o una acción con su workflow.
- API pública: la CLI de cada script (`self-release.py` por subcomandos; `review-pull-request.mjs` exporta `reviewPullRequest`) y el contrato YAML del workflow.

### Framework

| Ruta impuesta | Rol | Restricción |
| --- | --- | --- |
| `.github/workflows/*.yml` | Presentación / raíz | YAML de GitHub Actions; jobs delgados, lógica en scripts. |
| `.github/actions/*/action.yml` | Presentación | Superficie de la acción compuesta. |

### Intensidad y organización

- Intensidad:
  - automatización GitHub: ligera
- Organización: por carpeta que ya existe (`.github/workflows/`, `.github/scripts/`, `.github/actions/`), no por capa.
- Nombres de archivo: kebab-case en workflows; el script de release es `self-release.py`; el check de PR es `review-pull-request.mjs`.
- Unidades por archivo: un script por preocupación (manifiesto APM, check de PR, avisos).

### Estilo de los casos de uso

Funciones y subcomandos, no clases fábrica.

### Errores de dominio

- Cómo se entregan: código de salida distinto de 0 y mensaje en stderr, la forma que ya usan los scripts (R-ERR-05).
- Dónde vive el catálogo: no hay. Los mensajes van en el punto de fallo, en español, como el check de PR actual.
- `kind` además de VALIDATION, NOT_FOUND y CONFLICT: no aplica; no hay catálogo.
- Qué se hace fuera del dominio: el workflow falla el job; `review-pull-request.mjs` imprime un error por línea y sale 1.

### Verificación de fronteras

- Herramienta: ninguna. El repositorio no tiene `package.json` ni manifiesto Python de aplicación. Los scripts de `.github/scripts/` no se importan entre sí; las capas no viven en carpetas distintas. Una herramienta de fronteras no tendría contratos de importación que comprobar.
- Comando: no hay

## Parte: paquete APM

Ruta: `.apm/`. Skills, agentes y sus scripts, que `apm install` copia a la herramienta.

### Mapa de capas

| Rol | Ruta o glob | Notas |
| --- | --- | --- |
| Presentación | `.apm/skills/*/SKILL.md`, `.apm/agents/*.agent.md` | Instrucciones que lee el agente. |
| Servicios (aplicación + dominio) | `.apm/skills/*/scripts/*.{mjs,sh,py}` | Cada skill lanza su script. Ligera. |
| Infraestructura | Llamadas a `gh`, `git`, APIs y ficheros desde esos scripts | |
| Shared | `.apm/skills/*/assets/` | Plantillas y copias, sin negocio. |
| Platform | Node 24+, `gh`, APM | |
| Raíz de composición | `apm.yml` | Manifiesto del paquete. |
| Pruebas | `tests/*.mjs`, `tests/scripts.test.sh`, `tests/docs_rag/` | |

### Módulos

- Cómo se reconoce un módulo: una skill (carpeta con `SKILL.md`) o un agente (`.agent.md`).
- API pública: el nombre de la skill o del agente y la CLI de su script.

### Framework

| Ruta impuesta | Rol | Restricción |
| --- | --- | --- |
| `.apm/skills/*/SKILL.md` | Presentación | Frontmatter YAML y prosa; el script no pregunta. |
| `.apm/agents/*.agent.md` | Presentación | Frontmatter del agente. |
| `apm.yml` | Manifiesto | Versión, destinos y MCP. |

### Intensidad y organización

- Intensidad:
  - cada skill: ligera
  - `docs_rag` (dentro de `setup-docs-rag`): ligera
- Organización: por skill, con `scripts/` y `assets/` como ya está.
- Nombres de archivo: kebab-case en skills; el script principal lleva el nombre de la skill.
- Unidades por archivo: un script principal por skill.

### Estilo de los casos de uso

Funciones, ES modules y `run(argv)` donde ya existe (`setup-context7`, `setup-discord-notifications`, `issue-spec`).

### Errores de dominio

Igual que la automatización GitHub: código de salida y stderr. `docs_rag` usa excepciones de Python.

### Verificación de fronteras

- Herramienta: ninguna. Misma causa que la automatización GitHub.
- Comando: no hay

## Excepciones y decisiones

| Fecha | Regla | Decisión | Motivo |
| --- | --- | --- | --- |
| 2026-11-26 | R-GEN-05 | Intensidad ligera en todas las partes, anotada | El árbol son skills, workflows y scripts sueltos. Hay reglas de negocio (versión, autodependencia, salto de tag vacía) en los mismos archivos que el I/O. No se extrae dominio en esta tarea. |
| 2026-11-26 | R-EST-06 | Fronteras no comprobadas automáticamente | No hay manifiesto de dependencias ni carpetas por capa; los scripts no se importan entre sí. Instalar dependency-cruiser o import-linter no comprobaría ningún contrato. |
| 2026-11-26 | R-ERR-17 | Sin fábrica ni catálogo de errores de dominio | Los scripts entregan el fallo con la forma natural del lenguaje (salida ≠ 0 y stderr). |
