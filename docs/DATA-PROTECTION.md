# Protección de datos

`data-protection-guideline` es un checklist del RGPD y la LOPDGDD para cada tarea.

La guía la usan `concept-developer`, `concept-tester` y `legal-advisor`. Señala posibles problemas de cada tarea con su artículo. Tanto esta guía como `/setup-compliance` son orientativas: no certifican cumplimiento.

Para activarla, copia la plantilla `assets/datos-personales.md` de la skill a tu `docs/CONSTITUTION.md` y rellena sus cuatro campos: rol en el tratamiento, interesados, categorías especiales y estado de la DPIA. El rol lo decide la persona responsable del proyecto; la guía no lo deduce. Un campo vacío es un hueco y para el ciclo. Sin la sección, la guía dice en una línea que no actúa.

Con la sección:

- Si la tarea toca datos personales, la spec recoge como requisitos los ítems que aplican, con su artículo. Si el código o la documentación no los cumplen, la ronda falla como con cualquier otro requisito. `code-tester` y `code-developer` no precargan la guía: siguen la spec.
- Lo que `concept-tester` encuentra fuera de la spec va como nota al comentario de la ronda y no cambia el veredicto.
- Sin hallazgos, el reporte dice «Sin hallazgos frente al checklist vX.Y.Z (AAAA-MM-DD).».
- Una duda que el checklist no resuelve va a `legal-advisor` como consulta legal ([LEGAL-CONSULTATIONS.md](LEGAL-CONSULTATIONS.md)).

Los artículos citados viajan en la skill como copia informativa de los textos consolidados, con su fuente y su fecha. El checklist está pendiente de revisión jurídica.
