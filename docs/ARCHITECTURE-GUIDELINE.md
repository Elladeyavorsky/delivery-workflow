# Arquitectura en capas

La skill `layered-architecture-guideline` fija cuatro capas (presentación, aplicación, dominio e infraestructura) más shared, las dependencias hacia dentro y los errores de dominio, con mínimos de seguridad para toda la arquitectura. Decide dónde va cada pieza y cómo se separa. Respeta la estructura que impone un framework.

La usan `concept-developer` y `code-developer`. `code-tester` y `concept-tester` siguen el plan, no la precargan.

Si falta `docs/ARCHITECTURE.md`, `concept-developer` lo crea desde la plantilla de la skill, elige la intensidad de cada módulo y deja `Por decidir` el framework y cómo se entregan los errores de dominio. Si existe, añade las secciones de la plantilla que falten y conserva lo que ya hay; no sustituye el fichero. Escribe en el plan el mapa archivo → capa. `code-developer` coloca el código en su capa.

El mapa de capas es independiente del lenguaje. Cada proyecto elige y anota en `docs/ARCHITECTURE.md` la herramienta que verifica las fronteras; los agentes la proponen según el stack.
