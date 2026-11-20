# Checklist de protección de datos

Versión: 0.1.0 · Fecha: 2026-11-19 · Revisión jurídica: pendiente

Cada ítem dice cuándo aplica, qué hace quien construye (`concept-developer` lo lleva a la spec como requisito), qué mira quien comprueba (`concept-tester` y `code-tester`) y qué artículos lo sostienen. El texto de cada artículo está en `rgpd/articulo-N.md` o `lopdgdd/articulo-N.md`, como copia informativa. Un hallazgo es un posible problema con su referencia, no una conclusión jurídica.

### DP-01 · Principios: finalidad, minimización y conservación

- **Cuándo aplica:** La tarea recoge, guarda o reutiliza datos personales.
- **Quien construye:** Nombra la finalidad de cada dato, recoge solo los campos que esa finalidad necesita y fija cuánto tiempo se guardan y qué pasa al acabar ese plazo.
- **Quien comprueba:** Que cada campo nuevo tiene una finalidad escrita, que no se recogen campos sin uso y que el plazo de conservación existe en el código o en la configuración.
- **Artículos:** RGPD 5

### DP-02 · Base jurídica de cada tratamiento

- **Cuándo aplica:** La tarea empieza un tratamiento nuevo o usa datos para una finalidad distinta de la original.
- **Quien construye:** Escribe en la spec la base jurídica de cada tratamiento (consentimiento, contrato, obligación legal, interés vital, interés público o interés legítimo). Si la spec no la da, es un hueco.
- **Quien comprueba:** Que cada tratamiento nuevo tiene su base jurídica en la spec o en la documentación del proyecto.
- **Artículos:** RGPD 6

### DP-03 · Consentimiento: prueba y retirada

- **Cuándo aplica:** La base jurídica es el consentimiento.
- **Quien construye:** Pide un consentimiento por finalidad, con una acción afirmativa y sin casillas marcadas. Guarda quién lo dio, cuándo y para qué texto. Ofrece retirarlo de forma tan fácil como darlo. No condiciona el servicio a un consentimiento que no necesita.
- **Quien comprueba:** Que hay registro del consentimiento, que retirarlo es posible y deja de tratar los datos, y que no hay casillas premarcadas ni consentimientos agrupados.
- **Artículos:** RGPD 7, LOPDGDD 6

### DP-04 · Menores de 14 años

- **Cuándo aplica:** Interesados incluye menores de 14 años, o la tarea trata o publica datos de menores.
- **Quien construye:** Si la base es el consentimiento y el menor tiene menos de 14 años, exige el consentimiento de quien tiene la patria potestad o tutela y hace esfuerzos razonables para verificarlo. Antes de publicar o difundir datos de menores en Internet, y en redes sociales en particular, exige ese consentimiento.
- **Quien comprueba:** Que el flujo distingue la edad, pide y registra el consentimiento del titular de la patria potestad o tutela, y que nada publica datos de menores sin él.
- **Artículos:** RGPD 8, LOPDGDD 7, LOPDGDD 92

### DP-05 · Categorías especiales

- **Cuándo aplica:** Categorías especiales es «sí», o la tarea trata datos de salud, origen étnico o racial, opiniones políticas, convicciones religiosas o filosóficas, afiliación sindical, datos genéticos o biométricos para identificar, vida u orientación sexual.
- **Quien construye:** Nombra la excepción del RGPD 9.2 que permite el tratamiento. Si la excepción es el consentimiento, comprueba que la LOPDGDD 9 lo admite para esa categoría. Aplica medidas de seguridad reforzadas (DP-11).
- **Quien comprueba:** Que la spec nombra la excepción y que el código no trata estas categorías fuera de ella.
- **Artículos:** RGPD 9, LOPDGDD 9

### DP-06 · Información al interesado

- **Cuándo aplica:** La tarea recoge datos del interesado o de terceros, o cambia la finalidad.
- **Quien construye:** Muestra la información básica en el momento de la recogida (responsable, finalidad, derechos y dónde ampliar) y enlaza la información completa. Si los datos no vienen del interesado, prevé informarle en el plazo del RGPD 14.
- **Quien comprueba:** Que el formulario o la pantalla de recogida muestra la información básica y enlaza la completa, en lenguaje claro.
- **Artículos:** RGPD 12, RGPD 13, RGPD 14, LOPDGDD 11

### DP-07 · Derechos del interesado

- **Cuándo aplica:** La tarea guarda datos personales que el interesado puede pedir ver, corregir, borrar, limitar, llevarse u oponerse a su uso.
- **Quien construye:** Prevé cómo se atiende cada derecho: acceso, rectificación, supresión, limitación, portabilidad en formato estructurado y de lectura mecánica, y oposición. La supresión y la rectificación llegan a copias, cachés y destinatarios.
- **Quien comprueba:** Que hay una vía para cada derecho que afecta a los datos de la tarea y que borrar o corregir no deja copias activas.
- **Artículos:** RGPD 15, RGPD 16, RGPD 17, RGPD 18, RGPD 19, RGPD 20, RGPD 21

### DP-08 · Decisiones automatizadas y perfilado

- **Cuándo aplica:** La tarea toma decisiones sobre personas sin intervención humana, o hace perfilado, predicción, puntuación o rankings de personas.
- **Quien construye:** Si la decisión produce efectos jurídicos o afecta de forma significativa, prevé intervención humana, que el interesado exprese su punto de vista e impugne la decisión, e información sobre la lógica aplicada. Revisa DP-14.
- **Quien comprueba:** Que existe la intervención humana y la vía de impugnación, y que el perfilado aparece en la información al interesado.
- **Artículos:** RGPD 22, RGPD 35

### DP-09 · Protección de datos desde el diseño y por defecto

- **Cuándo aplica:** La tarea añade una funcionalidad, un campo o una opción de visibilidad sobre datos personales.
- **Quien construye:** Los valores por defecto son los más restrictivos: solo los datos necesarios, el menor plazo y sin hacerlos accesibles a un número indeterminado de personas. Usa seudonimización cuando la finalidad lo permita.
- **Quien comprueba:** Que los valores por defecto de visibilidad, conservación y recogida son los más restrictivos.
- **Artículos:** RGPD 25

### DP-10 · Encargados y servicios de terceros

- **Cuándo aplica:** La tarea envía datos personales a un servicio externo (alojamiento, correo, analítica, pagos, IA, soporte).
- **Quien construye:** Nombra el servicio, los datos que recibe y para qué. Si el servicio trata datos por cuenta del proyecto, la spec lo marca como encargado que necesita contrato. Envía solo los campos necesarios.
- **Quien comprueba:** Que cada servicio externo que recibe datos personales está nombrado en la spec o en la documentación y que no recibe más campos de los necesarios.
- **Artículos:** RGPD 28, LOPDGDD 28

### DP-11 · Seguridad y confidencialidad

- **Cuándo aplica:** La tarea guarda, transmite o muestra datos personales.
- **Quien construye:** Cifra en tránsito, controla el acceso por rol, no escribe datos personales en registros ni en mensajes de error y prevé copias de seguridad y su restauración. El nivel de medidas sigue al riesgo de los datos.
- **Quien comprueba:** Que el acceso está restringido, que los registros y errores no exponen datos personales y que los tests cubren el control de acceso.
- **Artículos:** RGPD 32, LOPDGDD 5

### DP-12 · Brechas de seguridad

- **Cuándo aplica:** La tarea guarda datos personales o cambia cómo se detectan incidentes.
- **Quien construye:** Deja registro de los accesos y de los incidentes para poder detectar una brecha, evaluarla y notificarla a la autoridad de control en 72 horas, y al interesado cuando haya alto riesgo.
- **Quien comprueba:** Que existe el registro de accesos o incidentes sobre los datos de la tarea.
- **Artículos:** RGPD 33, RGPD 34

### DP-13 · Bloqueo al suprimir o rectificar

- **Cuándo aplica:** La tarea suprime o rectifica datos personales.
- **Quien construye:** Antes de destruir los datos, los bloquea: quedan reservados, sin tratamiento ni visualización, solo a disposición de jueces, tribunales y autoridades durante el plazo de prescripción. Al acabar ese plazo, los destruye.
- **Quien comprueba:** Que suprimir o rectificar bloquea los datos anteriores en vez de dejarlos visibles o borrarlos sin más, y que el bloqueo tiene fin.
- **Artículos:** LOPDGDD 32

### DP-14 · Evaluación de impacto

- **Cuándo aplica:** La tarea hace perfilado, predicción, monitorización sistemática o rankings visibles de personas, trata a gran escala categorías especiales o datos de menores, o combina fuentes de datos.
- **Quien construye:** Si la tarea hace perfilado, predicción, monitorización o rankings visibles de personas y el campo Estado de la DPIA está vacío, levanta un hueco: probablemente hace falta una evaluación de impacto. Si el campo tiene valor, añade una nota con ese valor. Si la tarea trata a gran escala categorías especiales o datos de menores, o combina fuentes de datos, añade una nota con DP-14 y RGPD 35, nunca un hueco.
- **Quien comprueba:** Que la spec recoge el hueco o la nota sobre la evaluación de impacto.
- **Artículos:** RGPD 35
