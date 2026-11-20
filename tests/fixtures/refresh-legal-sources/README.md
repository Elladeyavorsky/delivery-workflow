# Fixtures de refresh-legal-sources

Hechos a mano el 2026-11-19 con la forma de las respuestas reales de ese día. El texto está recortado o inventado: no sirve como texto legal.

- `rgpd.xhtml`: XHTML del RGPD consolidado del Cellar (`celex/02016R0679-20160504`, `Accept: application/xhtml+xml`, `Accept-Language: spa`). Dos artículos (`art_8` y `art_12`) con el encabezado del capítulo III entre ellos, marcas ▼B, ▼C1 y ▼C2, y una lista de letras.
- `boe-indice.json`: índice de la LOPDGDD de la API de datos abiertos del BOE (`texto/indice`, `Accept: application/json`). El bloque `a2-5` es el «Artículo 23»; `a2-3` es un «Artículo 230» inventado para comprobar que el 23 no lo confunde; `a5-12` es el «Artículo 53 bis».
- `boe-bloque-a2-5.xml`: bloque con dos versiones (`texto/bloque/a2-5`, `Accept: application/xml`). La última trae una nota en `blockquote`.
- `boe-bloque-a7.xml`: bloque con una sola versión.
- `sources.json`: `sources.json` reducido a esos cuatro artículos.
