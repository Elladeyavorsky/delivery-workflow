# Las dudas legales las resuelve `legal-advisor` con EUR-Lex

El agente `legal-advisor` responde las dudas de protección de datos que el checklist de `data-protection-guideline` no resuelve. Consulta primero la guía (el checklist y los artículos empaquetados) y después el MCP `@cyanheads/eur-lex-mcp-server`, fijado a la versión 0.21.0. El MCP se configura con la skill `/setup-eur-lex`, un paso opcional tras `apm install`, como Context7 ([ADR 0012](0012-context7-se-configura-con-una-skill.md)).

## Cómo encaja en el ciclo

- **Quién pregunta:** `concept-developer` y `concept-tester` devuelven en su reporte las dudas que la guía no resuelve como «Consultas legales», cada una con su id `CL-NN`. No usan el MCP.
- **Quién llama:** El orquestador llama a `legal-advisor` una vez con todas las consultas de cada reporte: el de `concept-developer` que crea la spec, antes de la ronda 1, y los de cada ronda. Pregunta a la persona los huecos que devuelva y vuelve a llamar a `concept-developer` con las respuestas. Ningún subagente lanza a otro ([ADR 0001](0001-orquestador-y-entrevista-como-skills.md)). La consulta no gasta ronda.
- **Dónde queda la respuesta:** En un comentario de la issue ([ADR 0005](0005-la-spec-vive-en-la-issue.md)), con la respuesta, los artículos y la fuente de cada consulta: la guía con el fichero y la versión del checklist, o EUR-Lex con el CELEX y la fecha. El comentario no certifica cumplimiento.
- **Qué no resuelve:** Una consulta sin respuesta en la guía ni en EUR-Lex es un hueco para la persona. El paquete no añade condiciones de parada ([ADR 0004](0004-el-ciclo-corre-sin-aprobacion-humana.md)).
- **LOPDGDD:** EUR-Lex solo tiene derecho de la UE. Para la LOPDGDD, `legal-advisor` usa los artículos empaquetados; un artículo que no está empaquetado es un hueco. No consulta el BOE por red.
- **`code-tester`:** Deja de precargar la guía y comprueba los requisitos de protección de datos como cualquier otro requisito de la spec. Esto cambia lo que dice el [ADR 0013](0013-guia-de-proteccion-de-datos.md) sobre quién la precarga.

## Prueba previa

Antes de elegir cómo se instala el MCP, se probó si el campo `mcpServers` del frontmatter de un subagente sirve en las tres herramientas. La prueba se hizo el 2026-11-19 con Node v23.7.0, APM 0.35.0, Claude Code 2.1.322 y cursor-agent 2026.11.11, sin CLI de Codex. En un proyecto desechable se instaló con `apm install <ruta> --target claude,cursor,codex` una copia del paquete con un agente `probe` que declara `mcpServers.eur-lex` con `npx -y @cyanheads/eur-lex-mcp-server@0.21.0`.

| Comprobación | Resultado |
| --- | --- |
| APM conserva `mcpServers` en `.claude/agents/probe.md` | Sí |
| APM conserva `mcpServers` en `.cursor/agents/probe.md` | Sí |
| APM conserva `mcpServers` en `.codex/agents/probe.toml` | No. APM quita el campo y avisa: «Codex agent probe.agent.md: frontmatter field 'mcpServers' was dropped; this metadata is not translated by APM for Codex.». El `.toml` solo trae `name`, `description` y `developer_instructions`. |
| APM toca otro MCP que ya había en el proyecto | No, en ninguna de las tres herramientas |
| Claude Code (`claude -p`) da al subagente las herramientas del MCP | No. El subagente no recibió herramientas `mcp__eur*` y el log de `--debug=mcp` no tiene líneas de `eur-lex`. |
| Cursor (`cursor-agent -p`) da al subagente las herramientas del MCP | No. El subagente dice que no tiene herramientas MCP. |
| Codex arranca el MCP desde el agente | No ejecutado: no hay CLI de Codex. |

Lo que no se pudo distinguir:

- En Claude Code y en Cursor, si la herramienta no acepta el campo o si el servidor no arranca porque el paquete exige Node 24 o superior (`engines.node >=24.0.0`) y la máquina tenía Node 23. La repetición con un servidor compatible con Node 23 no se ejecutó.
- En Codex, si la herramienta aceptaría el campo. No cambia la decisión, porque APM lo quita antes.

La regla de la spec es que la prueba falla si APM pierde el campo en cualquiera de las tres herramientas. Lo pierde en Codex, así que el MCP se configura con una skill.

## Qué escribe `/setup-eur-lex`

- Config del MCP, sin tocar otros servidores: `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor) y `.codex/config.toml` (Codex), con `npx -y @cyanheads/eur-lex-mcp-server@0.21.0`. Repetirla no cambia nada.
- Sin regla en `AGENTS.md` ni `CLAUDE.md`: quién usa el MCP lo dicen las instrucciones de los agentes.
- Sin clave: el servidor no la necesita.

## Opciones consideradas

- **`mcpServers` en el frontmatter de `legal-advisor`:** El MCP viajaría con el agente y solo él lo tendría. APM quita el campo para Codex, y en Claude Code y Cursor la prueba no consiguió las herramientas del MCP. Se descarta mientras APM no traduzca el campo para Codex.
- **Dependencia MCP en `apm.yml`:** Toda persona que instale el paquete recibiría el MCP, aunque su proyecto no trate datos personales o no tenga Node 24. Se descarta. El ADR 0012 la dejó como alternativa para Context7 por el mismo motivo.
- **Dar el MCP a `concept-developer` y `concept-tester`:** Dos agentes consultarían la norma por su cuenta y cada respuesta quedaría en el reporte de quien la hizo, sin un sitio común para la fuente. Con `legal-advisor`, la respuesta y su fuente quedan en un solo comentario de la issue, y solo un agente lleva las instrucciones de uso del MCP. Se descarta.
- **Un fichero `COMPLIANCE_SPEC.md`:** La spec y lo que la justifica viven en la issue (ADR 0005). Se descarta.
- **La instancia alojada del MCP:** `legal-advisor` lanza el MCP con `npx` a la versión fijada 0.21.0 y solo en local (RF-09, RNF-05). Se descarta.

## Consecuencias

- Hay nueve agentes en `.apm/agents/` y veintitrés skills en `.apm/skills/`. `setup-eur-lex` lleva script y tests.
- Con la skill, el MCP queda configurado para el proyecto y lo ven el chat y todos los agentes. `concept-developer` y `concept-tester` dicen que no lo usan; `legal-advisor` es el único que lo nombra.
- El MCP necesita Node 24 o superior. Sin él, o si `npx` no puede descargar el paquete, `legal-advisor` responde solo con la guía y lo dice en el comentario. El resto del paquete sigue funcionando con Node 20.
- Si APM empieza a traducir `mcpServers` para Codex, hay que repetir la prueba previa con Node 24 antes de mover el MCP al frontmatter.
- Cómo se ejecuta `/setup-eur-lex` y qué necesita está en el [README](../../README.md), no aquí.
