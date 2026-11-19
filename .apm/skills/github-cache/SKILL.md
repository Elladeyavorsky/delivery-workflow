---
name: github-cache
description: "Reutiliza alias y datos públicos de colaboradores al resolver los revisores de una pull request. La usa manage-pr al pedir revisión."
---

# Caché de GitHub

Requiere Node 20+, Git, `gh` y el `GITHUB_TOKEN` del `.env` del proyecto; respeta `GH_HOST`. El script lanza `gh` con ese token, no con la sesión de `gh`, e identifica la cuenta del token para aislar sus datos.

Desde la raíz del repositorio git, ejecutar `node "<carpeta de esta skill>/scripts/github-cache.mjs"` con los siguientes comandos. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/github-cache`.

## Alias

Consultar primero la caché con `alias get OWNER/REPO "NOMBRE"...`. Si devuelve un login, reutilizarlo sin buscar de nuevo la identidad del revisor en GitHub. Resolver solo los `null` mediante el directorio y los perfiles; si no basta, comprobar autoría de commits del repositorio sin guardar correos.

Guardar coincidencias inequívocas con `alias set OWNER/REPO "NOMBRE" LOGIN`. Para corregirlas, añadir `--replace`; para olvidarlas, usar `alias remove OWNER/REPO "NOMBRE"`. Pedir aclaración ante ambigüedad.

## Colaboradores

Usar primero `directory OWNER/REPO`, que reutiliza el directorio local vigente. GitHub solo se consulta si falta, ha caducado o se pide `--refresh`. Ante una ausencia inesperada, refrescar con ETag: `304` conserva los datos y `200` los actualiza.

## Perfiles

Usar primero `profile OWNER/REPO LOGIN`, que reutiliza el nombre público guardado. GitHub solo se consulta si falta, ha caducado o se pide `--refresh`, usando ETag cuando existe una respuesta vigente.

## Caducidad y fallos

El archivo vive en la carpeta `.git/` del repositorio, que git no sigue. Se crea vacío; todos sus datos vencen a las 48 horas y se borran al siguiente acceso. No hay catálogo fijo. `cacheAvailable: false` indica que se continúa sin persistencia.

Un fallo de GitHub no confirma una identidad. Los permisos para revisar se comprueban en vivo mediante `assign-reviewers`.
