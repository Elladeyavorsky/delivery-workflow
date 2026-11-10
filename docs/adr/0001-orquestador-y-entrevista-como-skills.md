# El orquestador y la entrevista son skills, no subagentes

En Claude Code, Cursor y Codex un subagente trabaja solo hasta acabar y devuelve un único mensaje: no puede parar a preguntar a la persona y esperar la respuesta. El orquestador (`delivery-workflow`) tiene que pedir datos, resolver huecos de la spec y confirmar otra pasada, y `help-me-to-think` entrevista en tandas de preguntas, así que los dos son skills, que corren en la conversación principal. El orquestador nombra cada subagente al llamarlo, porque Codex solo delega cuando una skill o el usuario se lo piden.

Los subagentes de pasos (`create-issue`, `create-branch`, `create-commit`, `create-pr`) y los del ciclo (`concept-developer`, `code-developer`, `code-tester`, `concept-tester`) siguen siendo subagentes: casi nunca necesitan preguntar y así su salida no llena la conversación. `launch-push` no: en `staging` era un subagente que solo lanzaba su skill. Subir la rama es un comando sin preguntas y con una línea de salida, así que el orquestador lanza la skill directamente y se ahorra una llamada. Cuando uno necesita una respuesta (un nombre de revisor ambiguo, un hueco en la spec, la parte de arriba de la issue cambiada), devuelve la pregunta, el orquestador la hace en la conversación y lo vuelve a llamar con la respuesta.

## Opciones consideradas

- **Entrevista como subagente que devuelve sus preguntas** (lo que hace `staging` desde #925): el orquestador espera a la persona y vuelve a llamar al subagente con todo el historial de preguntas y respuestas. Se descarta para la entrevista porque reenvía el historial entero en cada vuelta y, si una llamada lo resume mal, se pierde contexto. Se usa solo para las preguntas sueltas de los subagentes de pasos y del ciclo.
