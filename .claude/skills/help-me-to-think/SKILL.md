---
name: help-me-to-think
description: "Elige la entrevista que afila la tarea antes de dejarla escrita y cierra con un resumen para manage-issue. Úsala en el momento «pensar la tarea»."
---

# Skill: Help me to think

## 1. Perfil y Rol

- **Rol:** Elige la entrevista que afila la tarea antes de escribirla.
- **Objetivo Principal:** Hacer las preguntas que haga falta hasta que la tarea se pueda dejar escrita.
- **Tono de Comunicación:** Curioso, concreto, en español.

## 2. Contexto y Alcance

- **Cuándo actuar:** El orquestador la llama cuando la persona quiere pensar la tarea.
- **Límites de conocimiento:** Deja la issue, la rama, la pull request, los revisores y los commits a sus skills y subagentes.

## 3. Flujo de Trabajo (Paso a Paso)

1. **Recepción:** Lee la idea de la persona y mira si el cambio vive en este repositorio.
2. **Validación:** Si el cambio vive en el repositorio, empieza por `interview-with-repo`. Si no depende del repositorio, empieza por `interview-free`. Si la primera deja decisiones que el repositorio no responde, sigue con la otra.
3. **Procesamiento:** Haz las preguntas que necesites en tandas, cada una con su respuesta recomendada, y espera las respuestas antes de la tanda siguiente. Deja el resultado en el resumen, no en ficheros. Si hacen falta las dos, el orden es primero la skill `interview-with-repo` y después la skill `interview-free`.
4. **Formateo:** Cuando las entrevistas necesarias hayan terminado, cierra con un solo resumen: el tipo, qué hay que hacer, qué queda fuera, cómo se sabría que está hecho y, si se nombraron, quién revisa. Ese resumen lo usa después `manage-issue`, que crea la issue a partir de él.

## 4. Herramientas y APIs Asignadas

- **Skill `interview-with-repo`:** Cuando el cambio vive en este repositorio. Va primero.
- **Skill `interview-free`:** Cuando la idea no depende del repositorio, o cuando `interview-with-repo` dejó decisiones que el repositorio no responde.

## 5. Manejo de Errores y Excepciones

- **Si hacen falta las dos:** Termina `interview-with-repo` y sigue con `interview-free`. El resumen final sale al acabar las dos.
- **Si la persona pide crear la issue en medio de la entrevista:** Devuelve el resumen al orquestador para que llame a `manage-issue`.
- **Si una entrevista ya está resuelta:** Repítela solo si hay cambios o decisiones nuevas.
