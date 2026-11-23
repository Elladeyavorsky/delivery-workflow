# Guía de clasificación del AI Act

Guía para `docs/ai-act.md`. Ordena las preguntas con que la skill propone una de cuatro categorías: prohibido, alto riesgo, riesgo limitado o riesgo mínimo. La clasificación es una propuesta que la persona confirma.

Fuente: Reglamento (UE) 2024/1689 (Reglamento de Inteligencia Artificial), CELEX `32024R1689`, en su texto consolidado `02024R1689-20260727`, que incorpora el Reglamento (UE) 2026/1744 (Omnibus digital sobre IA): https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:02024R1689-20260727. La guía cita artículos y anexos. El texto en español de los arts. 5, 6 y 50 y del anexo III está en `assets/reglamento-ia/articulo-N.md` y `anexo-III.md`: consúltalo antes de decidir. Las marcas `▼M1` señalan lo que añadió o cambió el Reglamento 2026/1744.

## Antes de empezar

Pregunta primero si el proyecto tiene un sistema de IA, es decir, si usa un modelo (propio o de un tercero) que infiere salidas (predicciones, contenido, recomendaciones o decisiones) a partir de entradas. Sin señal de IA, la clasificación más probable es riesgo mínimo, y se confirma con la persona. Pregunta también quién es el proveedor y quién el responsable del despliegue: las obligaciones cambian según el rol.

## Orden de preguntas

Recorre los pasos 1 a 3 en este orden y para en el primero que aplique. El paso 4 solo sigue a un alto riesgo del paso 3. El paso 5 se evalúa además, salvo que el paso 1 dé «prohibido».

### 1. Prácticas prohibidas (art. 5)

Pregunta si el sistema hace alguna de las prácticas del art. 5.1:

- **a)** técnicas subliminales o deliberadamente manipuladoras o engañosas que alteran de manera sustancial el comportamiento de una persona o un colectivo y provocan, o es razonablemente probable que provoquen, perjuicios considerables;
- **b)** explotación de vulnerabilidades por edad, discapacidad o situación social o económica específica, con ese mismo efecto sobre el comportamiento y el perjuicio;
- **b bis)** generar o manipular imágenes, vídeos o audios realistas de las partes íntimas de una persona física identificable, o de ella en actividades sexualmente explícitas, sin su consentimiento libre, específico, informado e inequívoco;
- **b ter)** generar o manipular material o espectáculos de abuso sexual infantil en el sentido del art. 2, letras c) y e), de la Directiva 2011/93/UE, salvo que el Derecho nacional aplique la defensa de «forma ilícita»;
- **c)** puntuación ciudadana (evaluar o clasificar personas durante un tiempo por su comportamiento social o sus características) que provoque un trato perjudicial en contextos ajenos a donde se recogieron los datos, o un trato injustificado o desproporcionado;
- **d)** evaluar el riesgo de que una persona cometa un delito basándose únicamente en su perfil o en los rasgos de su personalidad. No se prohíbe apoyar la valoración humana que ya se base en hechos objetivos y verificables;
- **e)** crear o ampliar bases de datos de reconocimiento facial con extracción no selectiva de imágenes de internet o de circuitos cerrados de televisión;
- **f)** inferir emociones en el trabajo o en centros educativos, salvo por motivos médicos o de seguridad;
- **g)** categorización biométrica que deduzca raza, opiniones políticas, afiliación sindical, convicciones religiosas o filosóficas, vida sexual u orientación sexual. Quedan fuera el etiquetado o filtrado de conjuntos de datos biométricos adquiridos lícitamente y la categorización en el ámbito de la garantía del cumplimiento del Derecho;
- **h)** identificación biométrica remota «en tiempo real» en espacios de acceso público para la garantía del cumplimiento del Derecho, salvo para los objetivos tasados del art. 5.1.h) y con las condiciones y la autorización previa de los apartados 2 y 3.

Las letras b bis) y b ter) tienen condiciones propias en los apartados 1 bis y 1 ter. Un proveedor solo incurre en la prohibición si generar o manipular ese material es la finalidad prevista del sistema, o si su diseño, entrenamiento, arquitectura, capacidades o funcionalidades hacen ese resultado razonablemente previsible y reproducible. Quien lo utiliza solo incurre si lo emplea para generarlo. Lee el texto completo de los apartados 1 bis y 1 ter antes de decidir.

- Si aplica alguna: categoría **prohibido**, con la letra del art. 5.1.
- Si hay duda: hueco, con la práctica dudosa.

Fuente: art. 5, apartados 1, 1 bis y 1 ter (texto en `assets/reglamento-ia/articulo-5.md`).

### 2. Alto riesgo por producto (art. 6.1 y anexo I)

Pregunta si el sistema es un componente de seguridad de un producto, o es él mismo un producto, que cae bajo la legislación de armonización de la Unión del anexo I (por ejemplo máquinas, juguetes, productos sanitarios, vehículos, aviación, ascensores) y que exige una evaluación de conformidad de tercero.

Los apartados 1 bis a 1 quater acotan la condición: un sistema que solo sirve a aspectos ajenos a la seguridad (asistencia al usuario, rendimiento, eficiencia, automatización, comodidad, control de calidad) no es componente de seguridad, salvo que su fallo pueda poner en peligro la salud y la seguridad. Un producto que exige evaluación de tercero solo por riesgos distintos de los de salud y seguridad no cumple la condición de la letra b).

- Si aplica: categoría **alto riesgo**, con art. 6.1 y el acto del anexo I.

Fuente: art. 6, apartados 1 a 1 quater, y anexo I.

### 3. Alto riesgo por ámbito (art. 6.2 y anexo III)

Pregunta si el sistema es uno de los casos de uso que el anexo III enumera en alguno de estos ámbitos. Mira la letra concreta en `assets/reglamento-ia/anexo-III.md`: un sistema del mismo ámbito que no encaja en un caso de uso no entra por aquí.

1. Biometría (identificación remota, categorización, reconocimiento de emociones).
2. Infraestructuras críticas (componente de seguridad de tráfico, agua, gas, calefacción, electricidad, digital).
3. Educación y formación profesional (acceso, evaluación, nivel educativo, vigilancia de exámenes).
4. Empleo y gestión de trabajadores (selección, ofertas, evaluación, ascensos, despidos, asignación de tareas).
5. Acceso a servicios esenciales (prestaciones públicas, solvencia y crédito, seguros de vida y salud, emergencias).
6. Garantía del cumplimiento del Derecho (víctimas, polígrafos, pruebas, riesgo de reincidencia, perfilado).
7. Migración, asilo y control de fronteras.
8. Administración de justicia y procesos democráticos.

- Si aplica un ámbito: categoría **alto riesgo**, con art. 6.2 y el punto y la letra del anexo III.
- Si el sistema hace perfilado de personas en un ámbito del anexo III, es alto riesgo siempre (art. 6.3, último párrafo).

Fuente: art. 6, apartado 2, y anexo III.

### 4. Excepciones del art. 6.3

Si el paso 3 dio alto riesgo, pregunta si el sistema no plantea un riesgo importante de perjuicio para la salud, la seguridad o los derechos fundamentales, también por no influir sustancialmente en el resultado de la toma de decisiones, y cumple alguna condición del art. 6.3:

- **a)** hace una tarea de procedimiento limitada;
- **b)** mejora el resultado de una actividad humana ya realizada;
- **c)** detecta patrones de toma de decisiones o desviaciones respecto a patrones anteriores, sin sustituir ni influir en la valoración humana previa sin una revisión humana adecuada;
- **d)** hace una tarea preparatoria de una evaluación pertinente para los casos de uso del anexo III.

Con perfilado de personas físicas la excepción no existe: sigue siendo alto riesgo.

- Si aplica y la persona lo confirma: anota la condición, el motivo y que el proveedor documenta la evaluación antes de introducir el sistema en el mercado o ponerlo en servicio, se registra conforme al art. 49.2 y entrega la documentación a las autoridades nacionales que se la pidan (art. 6.4). Sigue en el paso 5.
- Si no está claro: hueco, con lo que falta.

Fuente: art. 6, apartados 3 y 4.

### 5. Transparencia (art. 50)

Los pasos 2 a 4 deciden si el sistema es de alto riesgo. El paso 5 se evalúa siempre, salvo que el paso 1 diera «prohibido»: el art. 50.6 deja intactas las obligaciones de alto riesgo y suma las de transparencia. Pregunta qué hace el sistema y quién tiene cada obligación:

- **Interactúa directamente con personas físicas** (un chatbot): el proveedor lo diseña para que las personas sepan que hablan con una IA, salvo que sea evidente para una persona razonablemente informada, atenta y perspicaz, según las circunstancias y el contexto de uso (art. 50.1).
- **Genera contenido sintético de audio, imagen, vídeo o texto**, incluidos los sistemas de IA de uso general: el proveedor marca las salidas en formato legible por máquina para que se detecte que son artificiales. No aplica si el sistema solo apoya la edición estándar o no altera sustancialmente los datos de entrada (art. 50.2).
- **Reconoce emociones o categoriza por datos biométricos**: el responsable del despliegue informa del funcionamiento a las personas expuestas y trata sus datos conforme al RGPD, o a la norma de protección de datos que corresponda (art. 50.3).
- **Genera o manipula imágenes, audio o vídeo que constituyen una ultrafalsificación**: el responsable del despliegue hace público que son artificiales. En una obra o programa manifiestamente creativos, satíricos, artísticos, de ficción o análogos basta con declararlo de forma que no estorbe su exhibición ni su disfrute (art. 50.4, párrafo primero).
- **Genera o manipula texto publicado para informar al público sobre asuntos de interés público**: el responsable del despliegue declara que es artificial, salvo que una persona revise el texto o lo controle editorialmente y alguien asuma la responsabilidad editorial (art. 50.4, párrafo segundo).

La información llega a las personas de forma clara y distinguible, a más tardar en la primera interacción o exposición, y cumple los requisitos de accesibilidad aplicables (art. 50.5). El art. 50.6 deja además en pie otras obligaciones de transparencia del Derecho de la Unión o nacional para los responsables del despliegue. Los apartados 1 a 4 traen excepciones para sistemas autorizados por ley para detectar, prevenir, investigar o enjuiciar delitos. Si el proyecto trabaja en ese ámbito, es un hueco: decide la persona responsable.

- Si aplica alguno y el sistema no es de alto riesgo: categoría **riesgo limitado** (etiqueta de esta guía: el art. 50 no la usa), con el apartado del art. 50 y el rol (proveedor o responsable del despliegue).
- Si aplica alguno y el sistema es de alto riesgo: la categoría sigue siendo **alto riesgo**; anota las obligaciones del art. 50 además.
- Si no está claro quién es proveedor y quién responsable del despliegue: hueco.

Fuente: art. 50, apartados 1 a 6.

### 6. Riesgo mínimo

Si ningún paso aplica: categoría **riesgo mínimo**. No hay obligaciones específicas del Reglamento, más allá de las de alfabetización en IA y de los códigos de conducta voluntarios. Indica que se confirmó con la persona o deja un hueco.

Fuente: ausencia de coincidencia en los pasos 1 a 5, confirmada en entrevista (AAAA-MM-DD).

## Cómo se escribe el resultado en `docs/ai-act.md`

- Una categoría, el motivo en una frase y los artículos (y el punto del anexo) que la sostienen.
- Una línea `Fuente:` por afirmación: fichero del proyecto, sección de `docs/CONSTITUTION.md` o «entrevista (AAAA-MM-DD)».
- Lo que no se sabe es un hueco: `> **Hueco:** <qué falta>`.
- El documento no afirma que el proyecto cumpla la norma: describe la categoría propuesta y las obligaciones que el Reglamento asocia a ella, para que la persona las revise.

Documento orientativo: no certifica cumplimiento ni es asesoramiento jurídico.
