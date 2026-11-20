# Guía de clasificación del AI Act

Guía para `docs/ai-act.md`. Ordena las preguntas con que la skill propone una de cuatro categorías: prohibido, alto riesgo, riesgo limitado o riesgo mínimo. La clasificación es una propuesta que la persona confirma.

Fuente: Reglamento (UE) 2024/1689 (Reglamento de Inteligencia Artificial), CELEX `32024R1689`, https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32024R1689. La guía cita artículos y anexos y no copia su texto: consulta el texto oficial antes de decidir.

## Antes de empezar

Pregunta primero si el proyecto tiene un sistema de IA, es decir, si usa un modelo (propio o de un tercero) que infiere salidas (predicciones, contenido, recomendaciones o decisiones) a partir de entradas. Sin señal de IA, la clasificación más probable es riesgo mínimo, y se confirma con la persona. Pregunta también quién es el proveedor y quién el responsable del despliegue: las obligaciones cambian según el rol.

## Orden de preguntas

Recorre los pasos en este orden y para en el primero que aplique.

### 1. Prácticas prohibidas (art. 5)

Pregunta si el sistema hace alguna de las prácticas que enumera el art. 5: manipulación subliminal o engañosa que distorsiona el comportamiento, explotación de vulnerabilidades (edad, discapacidad, situación social), puntuación social, evaluación del riesgo de delito basada solo en perfiles, creación de bases de datos de reconocimiento facial por rastreo masivo, inferencia de emociones en el trabajo o en centros educativos, categorización biométrica para deducir datos sensibles e identificación biométrica remota en tiempo real en espacios públicos para la ley.

- Si aplica alguna: categoría **prohibido**, con el apartado del art. 5.
- Si hay duda: hueco, con la práctica dudosa.

Fuente: art. 5.

### 2. Alto riesgo por producto (art. 6.1 y anexo I)

Pregunta si el sistema es un componente de seguridad de un producto, o es él mismo un producto, que cae bajo la legislación de armonización de la Unión del anexo I (por ejemplo máquinas, juguetes, productos sanitarios, vehículos, aviación, ascensores) y que exige una evaluación de conformidad de tercero.

- Si aplica: categoría **alto riesgo**, con art. 6.1 y el acto del anexo I.

Fuente: art. 6, apartado 1, y anexo I.

### 3. Alto riesgo por ámbito (art. 6.2 y anexo III)

Pregunta si el sistema se usa en alguno de los ámbitos del anexo III:

1. Biometría (identificación remota, categorización, reconocimiento de emociones).
2. Infraestructuras críticas (componente de seguridad de tráfico, agua, gas, calefacción, electricidad, digital).
3. Educación y formación profesional (acceso, evaluación, nivel educativo, vigilancia de exámenes).
4. Empleo y gestión de trabajadores (selección, ofertas, evaluación, ascensos, despidos, asignación de tareas).
5. Acceso a servicios esenciales (prestaciones públicas, solvencia y crédito, seguros de vida y salud, emergencias).
6. Garantía del cumplimiento del Derecho (víctimas, polígrafos, pruebas, riesgo de reincidencia, perfilado).
7. Migración, asilo y control de fronteras.
8. Administración de justicia y procesos democráticos.

- Si aplica un ámbito: categoría **alto riesgo**, con art. 6.2 y el punto del anexo III.
- Si el sistema hace perfilado de personas en un ámbito del anexo III, es alto riesgo siempre (art. 6.3, último párrafo).

Fuente: art. 6, apartado 2, y anexo III.

### 4. Excepciones del art. 6.3

Si el paso 3 dio alto riesgo, pregunta si el sistema no plantea un riesgo significativo para la salud, la seguridad o los derechos fundamentales porque solo hace una tarea de procedimiento limitada, mejora el resultado de una actividad humana ya hecha, detecta patrones sin sustituir ni influir en la evaluación humana, o hace una tarea preparatoria. Sin perfilado de personas.

- Si aplica y la persona lo confirma: anota la excepción, el motivo y que el proveedor debe documentar la evaluación antes de comercializar el sistema (art. 6.4). La categoría pasa a la del paso 5.
- Si no está claro: hueco, con lo que falta.

Fuente: art. 6, apartados 3 y 4.

### 5. Transparencia (art. 50)

Pregunta si el sistema:

- interactúa directamente con personas (un chatbot): hay que informarles de que hablan con una IA;
- genera o manipula audio, imagen, vídeo o texto sintético: las salidas se marcan como generadas por IA;
- reconoce emociones o categoriza por datos biométricos: hay que informar a las personas expuestas;
- genera o manipula contenido que parece real (ultrafalsificaciones) o texto publicado para informar al público: hay que revelar que es artificial.

- Si aplica alguno: categoría **riesgo limitado**, con el apartado del art. 50.

Fuente: art. 50.

### 6. Riesgo mínimo

Si ningún paso aplica: categoría **riesgo mínimo**. No hay obligaciones específicas del Reglamento, más allá de las de alfabetización en IA y de los códigos de conducta voluntarios. Indica que se confirmó con la persona o deja un hueco.

Fuente: ausencia de coincidencia en los pasos 1 a 5, confirmada en entrevista (AAAA-MM-DD).

## Cómo se escribe el resultado en `docs/ai-act.md`

- Una categoría, el motivo en una frase y los artículos (y el punto del anexo) que la sostienen.
- Una línea `Fuente:` por afirmación: fichero del proyecto, sección de `docs/CONSTITUTION.md` o «entrevista (AAAA-MM-DD)».
- Lo que no se sabe es un hueco: `> **Hueco:** <qué falta>`.
- El documento no afirma que el proyecto cumpla la norma: describe la categoría propuesta y las obligaciones que el Reglamento asocia a ella, para que la persona las revise.

Documento orientativo: no certifica cumplimiento ni es asesoramiento jurídico.
