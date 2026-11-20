# La guía de protección de datos es orientativa

La skill `data-protection-guideline` es un checklist de protección de datos (RGPD y LOPDGDD) que precargan `concept-developer`, `concept-tester` y `legal-advisor` ([ADR 0014](0014-asesor-legal-con-eur-lex.md)). `code-tester` comprueba los requisitos de protección de datos como cualquier otro requisito de la spec. Señala posibles problemas de una tarea con el id del ítem y el artículo. No certifica cumplimiento ni añade una puerta bloqueante propia: el ciclo sigue parando solo por un hueco, un secreto o la ronda 9 fallida ([ADR 0004](0004-el-ciclo-corre-sin-aprobacion-humana.md)).

## Cómo encaja en el ciclo

- **Activación por el proyecto:** La guía actúa solo si `docs/CONSTITUTION.md` del proyecto tiene la sección `## Datos personales`. La sección dice el rol en el tratamiento, los interesados, si hay categorías especiales y el estado de la DPIA. La guía nunca deduce el rol: lo escribe la persona responsable del proyecto.
- **Triage por tarea:** Con la sección presente, la guía decide si la tarea toca datos personales. Si la duda no se resuelve, es un hueco.
- **Requisitos en la spec:** `concept-developer` escribe como requisitos los ítems que aplican, cada uno con su artículo. Si el código o la documentación no los cumplen, `concept-tester` y `code-tester` fallan el veredicto como con cualquier desajuste con la spec.
- **Notas fuera de la spec:** Un hallazgo frente al checklist que la spec no recoge va al reporte como nota y no cambia el veredicto.
- **Huecos:** Un choque entre un ítem y lo que dice el proyecto es un hueco. La guía no elige por la persona.
- **DPIA:** Una tarea de perfilado, predicción, monitorización o rankings visibles de personas con el campo Estado de la DPIA vacío levanta un hueco: probablemente hace falta una evaluación de impacto (RGPD 35). Con el campo relleno, el hallazgo es una nota. Son los únicos casos en que la DPIA levanta un hueco: tratar a gran escala categorías especiales o datos de menores, o combinar fuentes de datos, da una nota con DP-14 y RGPD 35.
- **Salida sin hallazgos:** «Sin hallazgos frente al checklist vX.Y.Z (AAAA-MM-DD).», con la versión y la fecha del checklist. Nunca «cumple». La cabecera del checklist dice que la revisión jurídica está pendiente.

## Textos legales empaquetados

Cada artículo citado viaja en `assets/rgpd/` o `assets/lopdgdd/` como copia del texto consolidado (el RGPD del Cellar de EUR-Lex y la LOPDGDD de la API de datos abiertos del BOE), con una cabecera de fuente, enlace, versión, fecha de descarga, aviso y adaptación. Cada norma lleva su aviso. La cabecera de la LOPDGDD sigue las condiciones de reutilización del BOE: nombra como fuente de los datos a la Agencia Estatal Boletín Oficial del Estado, avisa de que es un texto consolidado de carácter informativo y da la fecha de última actualización del bloque. `sources.json` registra cada norma, su versión y su distribución. Los textos se descargan con un script que solo usa quien mantiene el paquete ([MAINTENANCE.md](../MAINTENANCE.md#refrescar-los-textos-legales)); los proyectos reciben los ficheros ya generados.

## Opciones consideradas

- **Puerta bloqueante propia:** Cambiaría las condiciones de parada del ADR 0004. Los requisitos que la guía lleva a la spec ya fallan el veredicto; lo que queda fuera de la spec es una nota. Se descarta.
- **Descargar los textos en cada proyecto:** Exige un script de descarga en cada proyecto. Se empaquetan las dos normas para tener un solo mecanismo. Si la duda 1 de #56 concluye que la cláusula de indemnidad del BOE impide empaquetar la LOPDGDD, la LOPDGDD pasa a descargarse en cada proyecto y el RGPD sigue empaquetado.
- **Que `code-developer` precargue la guía:** Sigue la spec, que ya recoge los requisitos, y lee `docs/CONSTITUTION.md`. Se puede añadir si los fallos lo piden.
- **Que la guía deduzca el rol en el tratamiento:** Lo decide la persona responsable del proyecto, con apoyo jurídico. Se descarta.

## Consecuencias

- Hay veintidós skills en `.apm/skills/`. La nueva no lleva scripts; el de refresco vive en `.github/scripts/` con sus tests contra fixtures.
- La versión del paquete que incluye la guía no se publica hasta resolver dos dudas de #56: qué implica la cláusula de indemnidad del BOE para empaquetar la LOPDGDD (duda 1) y quién hace la revisión jurídica del checklist (duda 6). Si la LOPDGDD deja de empaquetarse, cambia su `distribucion` en `sources.json`.
- Cómo activar la guía está en el [README](../../README.md#protección-de-datos), no aquí.
