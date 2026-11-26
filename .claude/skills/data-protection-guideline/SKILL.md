---
name: data-protection-guideline
description: "Guía de protección de datos (RGPD y LOPDGDD) para la spec, la documentación y el código de una tarea: se activa con la sección ## Datos personales de docs/CONSTITUTION.md y señala posibles problemas con su artículo. Orientativa: no certifica cumplimiento ni añade paradas al ciclo. La precargan concept-developer, concept-tester y legal-advisor."
---

# Skill: Guía de protección de datos

## 1. Perfil y Rol

- **Rol:** Checklist de protección de datos para quien escribe la spec, quien la comprueba y quien responde las consultas legales.
- **Objetivo Principal:** Que los posibles problemas de protección de datos de una tarea aparezcan durante el ciclo, cada uno con el id del ítem y el artículo del RGPD o de la LOPDGDD.
- **Tono de Comunicación:** Neutro, breve, en español. Señala hallazgos; no da asesoramiento jurídico ni certifica cumplimiento.

## 2. Contexto y Alcance

- **Cuándo actuar:** `concept-developer` al escribir la spec; `concept-tester` al comprobar la spec y la documentación de la ronda; `legal-advisor` como primera fuente de las consultas legales. `code-tester` y `code-developer` no la precargan: siguen los requisitos de la spec.
- **Activación:** Solo si `docs/CONSTITUTION.md` del proyecto tiene la sección `## Datos personales`. La plantilla de esa sección está en `<carpeta de esta skill>/assets/datos-personales.md`.
- **Límites:** La guía no añade condiciones de parada. El ciclo sigue parando solo por un hueco, un secreto o la ronda 9 fallida. Nunca deduce el rol en el tratamiento: lo escribe la persona responsable del proyecto.

La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/data-protection-guideline`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

## 3. Flujo de Trabajo (Paso a Paso)

1. **Activación:** Lee `docs/CONSTITUTION.md`. Si no existe o no tiene la sección `## Datos personales`, responde en una línea «Protección de datos: el proyecto no declara datos personales; la guía no actúa.» y termina.
2. **Campos de la sección:** Rol en el tratamiento, Interesados, Categorías especiales y Estado de la DPIA. Un campo vacío, o con solo el comentario de la plantilla, es un hueco: uno por campo.
3. **Triage:** Decide si la tarea toca datos personales: si guarda, lee, muestra, envía, cruza, registra o borra datos que identifican a una persona o permiten identificarla, incluidos registros, analítica e identificadores. Si no los toca, responde en una línea «Protección de datos: la tarea no toca datos personales; la guía no actúa.» y termina. Si la tarea es ambigua, la duda es un hueco, no un «no toca».
4. **Ítems:** Lee `<carpeta de esta skill>/assets/checklist.md` y quédate con los ítems cuyo «Cuándo aplica» encaja con la tarea y con la sección del proyecto. Lee el fichero de un artículo solo cuando el ítem lo cite y necesites su texto.
5. **Según el rol:**
   - `concept-developer` escribe en la spec, como requisitos, lo que dice «Quien construye» de cada ítem que aplica, con el id y los artículos al final: `(DP-04; RGPD 8, LOPDGDD 7)`.
   - `concept-tester` mira lo que dice «Quien comprueba». Si la documentación no hace lo que pide un requisito de protección de datos de la spec, es un desajuste con la spec y falla el veredicto, como cualquier otro. Un hallazgo frente al checklist que no está en la spec va a «Notas de protección de datos», con el id del ítem y el artículo, y no cambia el veredicto.
   - `legal-advisor` busca primero en el checklist y en los artículos de `assets/` la respuesta a cada consulta legal. Si los usa, la fuente es esta guía, con el fichero y la versión del checklist.
6. **Choques y DPIA:**
   - Si una duda sobre la norma no la resuelven el checklist ni los artículos de `assets/` (qué artículo aplica o qué exige), `concept-developer` y `concept-tester` la devuelven como consulta legal, con su id `CL-NN`, la pregunta, el contexto de la tarea y los artículos candidatos. La responde `legal-advisor`; lo que no resuelve pasa a ser un hueco.
   - Si un ítem choca con lo que dice el proyecto (su documentación o sus tests), levanta un hueco con el ítem, el artículo y lo que dice el proyecto. No elijas entre los dos.
   - Si la tarea hace perfilado, predicción, monitorización o rankings visibles de personas y el campo Estado de la DPIA está vacío, levanta un hueco: probablemente hace falta una evaluación de impacto (RGPD 35). Si el campo tiene valor, el hallazgo es una nota. Es el único caso en que la DPIA levanta un hueco. Si la tarea trata a gran escala categorías especiales o datos de menores, o combina fuentes de datos, añade una nota con DP-14 y RGPD 35.
7. **Salida:** Los requisitos, desajustes, notas y huecos, cada uno con su id y su artículo. Sin hallazgos, la línea «Sin hallazgos frente al checklist vX.Y.Z (AAAA-MM-DD).» con la versión y la fecha de la cabecera del checklist.

## 4. Herramientas y APIs Asignadas

- **`<carpeta de esta skill>/assets/checklist.md`:** Los ítems `DP-NN`, con versión, fecha y estado de la revisión jurídica en la cabecera.
- **`<carpeta de esta skill>/assets/datos-personales.md`:** La sección que el proyecto copia a su `docs/CONSTITUTION.md`.
- **`<carpeta de esta skill>/assets/rgpd/articulo-N.md`:** Copia informativa de cada artículo citado del RGPD, con su fuente y su aviso. El texto auténtico es el publicado en el Diario Oficial.
- **`<carpeta de esta skill>/assets/lopdgdd/articulo-N.md`:** Texto consolidado de carácter informativo de cada artículo citado de la LOPDGDD. La fuente de los datos es la Agencia Estatal Boletín Oficial del Estado, con la fecha de su última actualización. El texto auténtico es el publicado en el Boletín Oficial del Estado.
- **`<carpeta de esta skill>/assets/sources.json`:** Fuente, enlace, versión y fecha de descarga de cada norma.

## 5. Manejo de Errores y Excepciones

- **Nunca escribas que el proyecto está conforme con la ley:** La salida sin hallazgos es la línea del paso 7, con la versión y la fecha del checklist.
- **Duda que la guía no resuelve:** Es una consulta legal, no un hueco ni una nota. Ni `concept-developer` ni `concept-tester` la buscan fuera de la guía.
- **Hallazgo fuera de la spec:** Es una nota. No cambia el veredicto ni para el ciclo.
- **Un ítem cita un artículo sin fichero en `assets/`:** Cita el artículo igual y dilo en el reporte.
- **El proyecto pide asesoramiento jurídico:** No lo des. Señala el ítem y el artículo, y deja la decisión a la persona responsable del proyecto.
