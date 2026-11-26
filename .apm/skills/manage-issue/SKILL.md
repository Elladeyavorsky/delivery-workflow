---
name: manage-issue
description: "Crea la issue en GitHub con la plantilla de su tipo, la etiqueta del tipo y asignada a la cuenta del token. Úsala para dejar la tarea escrita."
---

### Herramienta: MANAGE_ISSUE

- **Descripción**: Úsala para dejar la tarea escrita en GitHub. La rama y la pull request las abren `manage-branch` y `manage-pr`.
- **GitHub**: `bash "<carpeta de esta skill>/scripts/gh.sh" ARGUMENTOS`, desde la raíz del repositorio git. Lanza `gh` con el `GITHUB_TOKEN` del `.env` del proyecto. Usa siempre este script: así la issue queda a nombre de la cuenta del token.
- **Issue**: `bash "<carpeta de esta skill>/scripts/manage-issue.sh" "[TITULO]" "[FICHERO]" "[TIPO]"`, desde la raíz del repositorio git. Escribe antes el cuerpo en un fichero temporal. El script comprueba el título con `check-title.sh`, deja lista la etiqueta con `ensure-label.sh` y crea la issue asignada a `@me`, en ese orden. Si el título no pasa, no crea nada.

La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/manage-issue`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

#### Especificación de Argumentos

1. **Tipo** _(Obligatorio)_: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`. Ningún otro.
2. **Título** _(Obligatorio)_: En inglés, de menos de 72 caracteres, empieza por un verbo en imperativo con mayúscula (`Add`, `Fix`, `Document`…), sin el tipo delante, sin número de issue y sin punto final. Ejemplo: `Add a delivery-workflow test note`, no `docs: añadir nota de prueba`. Si te llega en español o con el tipo delante, tradúcelo y reescríbelo antes de seguir.
3. **Cuerpo** _(Obligatorio)_: Español. Rellena la plantilla del tipo, `<carpeta de esta skill>/assets/<tipo>_issue.md`, con «Qué hay que hacer» y «Cómo probarlo». Si el tipo no tiene plantilla, usa la más cercana. Si la persona nombró revisores, añade al final una línea `Revisan: nombre, nombre`.
4. **Persona asignada** _(Obligatorio)_: `@me`, la cuenta del token.
5. **Etiqueta** _(Obligatorio si existe)_: El nombre exacto del tipo.

#### Reglas de Invocación Críticas

- **Etiqueta**: Si la cuenta no puede crear la etiqueta, el script crea la issue sin ella y lo dice: comunícalo.
- **Título**: Si el script sale con 1 por el título, corrige el título según su mensaje y vuelve a lanzarlo. Crea la issue solo con `manage-issue.sh`: es el camino que comprueba el título antes de llamar a `gh`.
- **Otros errores**: Si sale con 1 por el tipo o el cuerpo, o con 3 porque falta el token del `.env`, comunica el error. No se ha creado la issue.
- **Sin spec**: Deja el cuerpo con la plantilla del tipo. `concept-developer` añade debajo `## Spec`, `## Plan` y `## Tasks`.
- **Procesamiento de respuestas**: `gh` escribe la URL de la issue: el número es su última parte. Quédate con el número, el título, la URL y la etiqueta. Si `gh` devuelve un error, comunícalo: el número no se supone.
