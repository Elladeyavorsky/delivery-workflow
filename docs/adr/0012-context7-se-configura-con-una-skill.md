# Context7 se configura con una skill opcional

Context7 da a los agentes la documentación actual de cada librería a través de un servidor MCP. Se configura con la skill `/setup-context7`, un paso opcional tras `apm install`. La skill lee las dependencias del proyecto, sugiere para cuáles usar Context7, y tras la confirmación escribe el MCP en cada herramienta y una regla en el proyecto.

El paquete no declara Context7 en `apm.yml`. Cada proyecto tiene librerías distintas y cada persona decide si quiere un servicio de terceros, así que la configuración vive en el proyecto y no viaja con el paquete. Cada MCP nuevo tendrá su propia skill de configuración.

## Qué escribe

- Config del MCP, sin tocar otros servidores: `.cursor/mcp.json` (Cursor), `.mcp.json` (Claude Code) y `.codex/config.toml` (Codex), con el servidor remoto `https://mcp.context7.com/mcp`.
- Un bloque entre marcadores con la lista de librerías en `AGENTS.md` (Cursor y Codex) o `CLAUDE.md` (Claude Code).
- La clave sale del entorno ([ADR 0007](0007-el-token-sale-del-env.md)). Con `--with-key` la config nombra la variable `CONTEXT7_API_KEY` y cada herramienta la lee con su sintaxis: `${env:CONTEXT7_API_KEY}` en Cursor, `${CONTEXT7_API_KEY}` en Claude Code y `bearer_token_env_var` en Codex. El valor nunca se escribe.
- Sin `--with-key` no se escribe ninguna cabecera: Context7 funciona con el límite por defecto. Una cabecera con la variable sin definir haría que Claude Code envíe el texto `${CONTEXT7_API_KEY}` y que Cursor envíe un valor vacío, y el servicio podría rechazar las peticiones.

## Opciones consideradas

- **Dependencia MCP en `apm.yml`:** APM generaría los archivos, pero toda persona que instale el paquete recibiría Context7 y la cabecera con la clave, y no hay forma de sugerir librerías. No se probó que APM admita el bloque. Queda como alternativa.
- **Solo mostrar el bloque para pegarlo:** Más simple, pero cada herramienta tiene su formato y es fácil equivocarse.
- **Enlazarla desde el orquestador:** El flujo de entrega funciona sin Context7. Es un paso de instalación, no del ciclo.

## Consecuencias

- Hay veintiuna skills en `.apm/skills/`. La nueva lleva script y tests.
- `apm install` no toca los archivos de config MCP mientras el paquete no declare MCP en `apm.yml` (comprobado con APM 0.35.0 y Cursor). Si algún día los declara, habrá que repetir la comprobación.
- Cursor y Codex comparten `AGENTS.md`: `reset` de una herramienta conserva la regla mientras la otra siga usando Context7.
- La sintaxis de la cabecera con variable de entorno viene de la documentación de cada herramienta y no se ha probado con un editor real.
- Las sugerencias salen de una lista de familias y descartes en `assets/library-profiles.json`. Lo que no está en la lista se muestra como «otra» y no se propone.
