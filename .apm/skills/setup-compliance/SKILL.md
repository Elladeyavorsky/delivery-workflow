---
name: setup-compliance
description: "Genera la documentación de compliance del proyecto en docs/: clasificación del AI Act, DPIA, threat model y las fichas (model card, data card, system card) que apliquen. Lee las dependencias y los ficheros del proyecto, entrevista en tandas con respuesta recomendada y no pisa un documento que la persona editó. Úsala tras apm install, o cuando cambie el sistema y haya que regenerar. Orientativa: no certifica cumplimiento ni es asesoramiento jurídico."
---

### Herramienta: SETUP_COMPLIANCE

- **Descripción**: Úsala para dejar en `docs/` una base de compliance del proyecto: `ai-act.md`, `dpia.md`, `security.md`, `system-card.md` y, si hay modelo o datos de entrenamiento propios, `model-card.md` y `data-card.md`. Los documentos son una base orientativa que la persona revisa: no certifican cumplimiento ni son asesoramiento jurídico. Funciona con Cursor, Claude Code y Codex.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/setup-compliance.mjs" ORDEN [OPCIONES]`, desde la raíz del repositorio.

La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/setup-compliance`; en Claude Code, `${CLAUDE_SKILL_DIR}`. La lanzas con `/setup-compliance` (en Codex, `$setup-compliance`). Requiere Node 24+.

#### Especificación de Argumentos

1. **Orden** _(Obligatorio)_:
   - `detect`: no escribe nada. Devuelve JSON con:
     - `manifests`: los manifiestos leídos, con `file`, `ecosystem` y `count`; uno ilegible trae `error` y no para el resto.
     - `aiSignals`: las dependencias de IA (con el fichero de donde salen) y los ficheros de pesos de modelo.
     - `datasetFiles`: los ficheros que encajan con los patrones de datos de entrenamiento.
     - `personalData`: si `docs/CONSTITUTION.md` tiene `## Datos personales` y el valor de sus cuatro campos (rol en el tratamiento, interesados, categorías especiales, estado de la DPIA). Un campo vacío vale `null`.
     - `docs`: el estado de cada documento: `ausente`, `generado` o `editado`.
     - `suggested`: los documentos que propone generar.
   - `write`: escribe un documento en `docs/` con una marca de hash en su primera línea. Devuelve JSON con `result`: `creado`, `igual`, `actualizado` o `conservado` (existe y la persona lo editó: no se escribe nada).
2. **`--doc NOMBRE`** _(con `write`)_: `ai-act`, `dpia`, `model-card`, `data-card`, `system-card` o `security`.
3. **`--from FICHERO`** _(con `write`)_: el fichero con el contenido ya relleno. Su última línea no vacía es exactamente la línea orientativa de la plantilla.
4. **`--root RUTA`** _(Opcional)_: la raíz del proyecto, si no es el repositorio actual.

#### Plantillas y guía

Están en `<carpeta de esta skill>/assets/`:

- `ai-act-classification.md`: la guía que ordena las preguntas de la clasificación del AI Act.
- `ai-act.md`, `dpia.md`, `security.md`, `system-card.md`, `model-card.md` y `data-card.md`: una plantilla por documento. Cada sección lleva un comentario guía, una línea `Fuente:` y, al final, la línea orientativa.
- `ai-signals.json`: la lista de dependencias de IA que usa `detect`.

#### Reglas de Invocación Críticas

- **Tú hablas, el script no**: El script nunca pregunta. Las preguntas las haces tú y le pasas el contenido con `--from`.
- **Fuente de cada afirmación**: Cada afirmación lleva su fuente en una línea `Fuente:`: la ruta del fichero del proyecto, la sección de `docs/CONSTITUTION.md` o «entrevista (AAAA-MM-DD)» con la fecha de hoy.
- **Huecos**: Lo que no deduces del proyecto ni te responde la persona queda como `> **Hueco:** <qué falta>`. Un hueco no te para: sigue y cuéntalo en la tabla final.
- **Nunca afirmes que el proyecto cumple la norma**: ni en los documentos ni en tus respuestas. La clasificación es una propuesta que la persona confirma.
- **Flujo**:
  1. Lanza `detect`. Si falla, comunica el error.
  2. Muestra una tabla con las señales de IA y su fuente, el estado de cada documento y los documentos propuestos. Si `aiSignals` está vacío, avisa de que el AI Act puede no aplicar al proyecto.
  3. Entrevista en tandas de 3 a 5 preguntas, con una respuesta recomendada por pregunta cuando el proyecto da pistas (`[Enter = recomendada]`). No preguntes lo que `detect` o los ficheros del proyecto ya responden. Temas: finalidad del sistema, usuarios, decisiones que toma sobre personas, origen de los datos, despliegue y, si hay modelo propio, su entrenamiento y evaluación.
  4. Confirma **una vez** la lista de documentos que vas a generar. La persona puede quitar o añadir fichas. Sin modelo propio (`suggested` sin `model-card`), no propongas `model-card`.
  5. `ai-act`: sigue `assets/ai-act-classification.md` pregunta a pregunta y propón una de las cuatro categorías (prohibido, alto riesgo, riesgo limitado, riesgo mínimo) con el motivo y los artículos. Que la persona la confirme. Sin señales de IA y sin confirmación, escribe «riesgo mínimo» solo si la persona lo confirma; si no, deja un hueco.
  6. `dpia`: toma `personalData` de `detect` y cita la sección `## Datos personales` de `docs/CONSTITUTION.md` como fuente. Si existe la carpeta de la skill `data-protection-guideline` (en opencode, Cursor y Codex, `.agents/skills/data-protection-guideline`; en Claude Code, `.claude/skills/data-protection-guideline`), lee su `assets/checklist.md` y lista riesgos y medidas con el id `DP-NN` y el artículo. Si el proyecto no declara datos personales, dilo en el documento como hueco, sin inventar el rol.
  7. `security`: activos, actores, amenazas (incluidas las propias de IA: inyección de instrucciones, fuga de datos por las respuestas y envenenamiento de datos) y una mitigación por amenaza, o un hueco.
  8. Rellena cada plantilla en un fichero temporal, sin los comentarios guía y con la línea orientativa como última línea no vacía. Antes de escribir, mira `docs` de `detect`: si un documento está `editado`, avisa a la persona de que no lo vas a tocar (`conservado`) y de que, si quiere regenerarlo, mueva o borre el suyo. Después lanza `write --doc NOMBRE --from FICHERO` por documento.
  9. Muestra la tabla final con documento, ruta, `result` y número de huecos, y recuerda que los documentos son una base orientativa que la persona revisa.
- **No se ejecuta en `apm install`**: La lanza la persona. No cambia `docs/CONSTITUTION.md`.
- **Procesamiento de respuestas**: El script escribe JSON. Si el código de salida no es 0, lee el error y comunícalo; un `write` rechazado no escribe nada. Usa solo las señales y los resultados que devuelve el script.
