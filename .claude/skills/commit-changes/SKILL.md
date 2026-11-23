---
name: commit-changes
description: "Hace un commit solo con los ficheros nombrados de un trozo, con un conventional commit en inglés. Úsala para guardar un trozo; el commit vacío lo hace manage-empty-commit."
---

### Herramienta: COMMIT_CHANGES

- **Descripción**: Úsala para guardar un trozo con ficheros nombrados. El commit vacío de apertura es de `manage-empty-commit`. Nombra cada fichero: `git add -A` y el directorio entero quedan fuera porque arrastran cambios ajenos al trozo.
- **Comando de Terminal**: `bash "<carpeta de esta skill>/scripts/commit-changes.sh" "[MENSAJE]" "[FICHERO_1]" "[FICHERO_2]"`

El comando se lanza desde la raíz del repositorio git, porque las rutas de los ficheros son relativas a ella. La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/commit-changes`.

Fuente: un commit es un conventional commit, como en [github-pr](https://www.skills.sh/gentleman-programming/gentleman-skills/github-pr). En este paquete caben varios commits pequeños en la misma pull request.

#### Especificación de Argumentos

1. **MENSAJE** _(Obligatorio)_: Conventional commit en inglés, `tipo: descripción`. El tipo es `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`.
2. **FICHERO** _(Obligatorio, uno o más)_: Ruta desde la raíz del repo. Repite el argumento por cada fichero del trozo.

#### Reglas de Invocación Críticas

- **Mensaje técnico:** Primera línea `tipo: descripción` o `tipo(ámbito): descripción`, en inglés, en imperativo, sin punto final. Dice qué cambió con un verbo concreto (`add`, `fix`, `remove`). Apunta a 50 caracteres, máximo 72. Nombra la acción, no el fichero: `update files` o `added` no dicen nada. Un cambio incompatible lleva `!` tras el tipo: `feat(api)!: …`. El commit vacío sigue siendo `chore: open #N`, sin cuerpo.
- **Desglose:** Tras una línea en blanco, el detalle técnico de este commit, en inglés. Cada línea cabe en 72 caracteres. Nombra las funciones, los campos o los ficheros implicados. Explica por qué se hizo y, si el diff no lo deja claro, qué cambió. No repite la primera línea. Si la pull request tiene varios commits, cubre solo este. En un commit trivial puede omitirse.
- **Pie:** Tras otra línea en blanco, la referencia a la issue: `Closes #N` o `Refs #N`. Si el tipo lleva `!`, añade `BREAKING CHANGE:` y qué deja de funcionar.
- **Ejemplo:** Muestra la forma. Adapta el contenido al cambio.

  ```
  feat(reports): print the stored total

  printTotal recomputed the sum from report.lines on every call, so it
  ignored the discounts addLine already applies to report.total.
  src/reports/print-total.js now reads report.total instead of reducing
  lines; the sum helper is removed.

  Closes #42
  ```
- **Escapado de caracteres**: Si el mensaje contiene comillas dobles (`"`), escápalas como `\"`.
- **Procesamiento de respuestas**: El script lista el mensaje y los ficheros. El commit lleva solo esos ficheros: lo que ya estuviera preparado se queda preparado. Si el código de salida no es 0, reintenta solo con los ficheros que nombró la persona.
