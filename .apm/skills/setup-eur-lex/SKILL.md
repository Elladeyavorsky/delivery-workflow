---
name: setup-eur-lex
description: "Configura el MCP de EUR-Lex (@cyanheads/eur-lex-mcp-server 0.21.0) en Cursor, Claude Code y Codex para que legal-advisor consulte el derecho de la UE. Úsala tras apm install, en proyectos que tratan datos personales. Necesita Node 24 o superior para arrancar el MCP."
---

### Herramienta: SETUP_EUR_LEX

- **Descripción**: Úsala única y exclusivamente para escribir o quitar el MCP `eur-lex` en la configuración de cada herramienta. El servidor es `@cyanheads/eur-lex-mcp-server`, fijado a la versión 0.21.0, y corre en local con `npx -y @cyanheads/eur-lex-mcp-server@0.21.0`. No necesita clave. Lo usa solo `legal-advisor`; sin esta configuración, `legal-advisor` responde solo con `data-protection-guideline`.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/setup-eur-lex.mjs" ORDEN [OPCIONES]`, desde la raíz del repositorio.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/setup-eur-lex`.

#### Especificación de Argumentos

1. **Orden** _(Obligatorio)_:
   - `apply`: escribe el servidor `eur-lex` en `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor) y `.codex/config.toml` (Codex). Los demás MCP quedan como estaban. Repetirlo no cambia nada.
   - `reset`: quita el servidor `eur-lex` de esos ficheros. Los demás MCP quedan como estaban.
2. **`--target cursor|claude|codex`** _(Opcional)_: una sola herramienta. Por defecto, todas las que tengan carpeta de agentes.

#### Reglas de Invocación Críticas

- **Flujo**:
  1. Lanza `apply`. Si falla porque no hay carpeta de agentes, dile a la persona que ejecute `apm install`.
  2. Muestra una tabla con herramienta, fichero de configuración y `result`, y las `notes`.
  3. Recuerda recargar el editor, o la sesión de Claude Code o Codex, para que cargue el MCP.
- **Node 24**: El paquete exige Node 24 o superior. Si la terminal tiene una versión anterior, `apply` escribe la configuración igual y lo avisa en `notes`. El resto del paquete funciona con Node 20.
- **Sin regla en el proyecto**: La skill no escribe en `AGENTS.md` ni en `CLAUDE.md`. Quién usa el MCP lo dicen las instrucciones de los agentes.
- **Después de `apm install` o `apm update`**: Los ficheros de config MCP no se tocan. No hace falta repetir `/setup-eur-lex`.
- **Procesamiento de respuestas**: El script escribe JSON. `result` vale `cambiado`, `igual` o `ausente`. Si el código de salida no es 0, lee el error y comunícalo: 2 es un argumento mal escrito y 3 un proyecto sin carpetas de agentes o un fichero de config con JSON o TOML inválido. Un fichero inválido no se modifica, y ningún otro se escribe en esa llamada.
