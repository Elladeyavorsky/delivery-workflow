# Consultas legales con EUR-Lex

La guía `data-protection-guideline` ([Protección de datos](DATA-PROTECTION.md)) resuelve las dudas de protección de datos que cubren su checklist y los artículos que trae. Las demás son consultas legales, y las responde el agente `legal-advisor`. Sus respuestas no certifican cumplimiento.

## Flujo

1. `concept-developer` y `concept-tester` devuelven las dudas que la guía no resuelve como consultas legales, cada una con su id `CL-NN`.
2. El orquestador las pasa todas a la vez a `legal-advisor`, que las resuelve primero con la guía y después con el MCP de EUR-Lex.
3. `legal-advisor` publica en la issue un comentario con la respuesta, los artículos y la fuente de cada una: la guía con la versión del checklist, o EUR-Lex con el CELEX y la fecha.
4. `concept-developer` escribe en la spec los requisitos que salen de las respuestas, con el id y el artículo: `(CL-01; RGPD 46)`.

La consulta no gasta ronda.

Lo que `legal-advisor` no resuelve es un hueco y el orquestador te lo pregunta. EUR-Lex solo tiene derecho de la UE: para la LOPDGDD, `legal-advisor` usa los artículos empaquetados, y un artículo que no está empaquetado es un hueco.

## El MCP de EUR-Lex

El MCP es `@cyanheads/eur-lex-mcp-server`, fijado a la versión 0.21.0, y corre en local con `npx`. No necesita clave. Viene con el paquete: `apm install` escribe el servidor `eur-lex` en `opencode.json`, `.mcp.json`, `.cursor/mcp.json` o `.codex/config.toml`, según tus herramientas, sin tocar otros MCP. No hay que configurar nada. Recarga el editor o la sesión después de instalar.

> **Nota:** El MCP necesita Node 24 o superior. Sin él, `legal-advisor` responde solo con la guía y el comentario dice que no usó EUR-Lex.
