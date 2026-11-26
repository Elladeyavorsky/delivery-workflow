# Context7

Context7 es el canal de documentación por defecto. Para comparar los canales y elegir, ver [Canales de documentación](DEPENDENCY-DOCS.md#canales-de-documentación).

[Context7](https://context7.com) da a los agentes la documentación actual y de la versión concreta de cada librería, para que no escriban código para versiones antiguas. `/setup-context7` escribe el MCP `context7` en `~/.config/opencode/opencode.json` (opencode; con `XDG_CONFIG_HOME`, dentro de esa carpeta), `~/.claude.json` (Claude Code), `~/.cursor/mcp.json` (Cursor) y `~/.codex/config.toml` (Codex), sin tocar otros MCP, y deja una regla con tus librerías en `AGENTS.md` o `CLAUDE.md`.

opencode lee también `opencode.jsonc`. La skill no lo modifica: si declara `context7` o `docs-rag`, lo avisa. En opencode 2.x, reinicia opencode para que cargue el MCP.

La clave es opcional: sin ella, el límite de peticiones es menor. Para usarla, crea una clave gratis en context7.com/dashboard y añádela al `.env`, junto al token del forge:

```dotenv
CONTEXT7_API_KEY=tu-clave
```

Los editores no leen el `.env` solos. Antes de abrir el editor, cárgalo en la terminal y ábrelo desde ahí:

```bash
set -a; source .env; set +a
opencode      # o claude, cursor ., o codex
```
