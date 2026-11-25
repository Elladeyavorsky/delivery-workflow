# Frameworks

Se lee para derivar las capas de un framework que impone estructura. El protocolo está en `SKILL.md` (R-AGT-07, R-EST-08). Los casos de abajo son ejemplos, no una lista exhaustiva.

## Equivalencias por tipo de proyecto

Tras la tabla «¿en qué capa va esto?» de `SKILL.md`:

- API: la presentación son rutas y controladores.
- App móvil o frontend: pantallas, componentes y *view-models*; la aplicación incluye los almacenes de estado que orquestan.
- CLI: análisis de argumentos y códigos de salida.
- *Worker*: consumidor de colas o planificador.
- Proyecto con varias partes: cada parte tiene su propio mapa de capas y se comunica con las demás por su contrato (API, mensajes), no por imports.

MVC, MVP y MVVM son patrones internos de la presentación, no capas distintas.

## Protocolo

1. Identifica lo que el framework impone: rutas basadas en ficheros, pantallas, módulos, migraciones, arranque, enganche global de errores.
2. Clasifícalo como capa exterior (presentación, infraestructura, platform o raíz de composición).
3. Dominio y aplicación no importan nada del framework.
4. Los archivos impuestos se mantienen delgados: delegan en la capa que corresponda; no contienen negocio ni acceso a datos.
5. Si el framework fusiona capas, se usa la variante ligera y la excepción se escribe en «Excepciones y decisiones» de `docs/ARCHITECTURE.md`.

La correspondencia de cada ruta impuesta con su rol se declara en el mapa.

## Ejemplos

- Rutas por fichero (por ejemplo, un *app router*): el fichero de ruta es presentación. Valida forma, invoca un caso de uso y presenta. La carpeta la impone el framework; la lógica no.
- Módulos con controlador, servicio y repositorio (por ejemplo, un framework de API con inyección): el controlador es presentación; el servicio, aplicación si orquesta y no mezcla SQL; el repositorio, infraestructura. Si el «servicio» mezcla las tres, se extrae dominio y se deja el servicio delgado, o se declara variante ligera.
- MVC clásico (controlador + modelo + plantilla): el controlador y la plantilla son presentación. El modelo del framework no es el dominio: las reglas salen a entidades o funciones, y la persistencia queda en infraestructura.
- Anotaciones o decoradores de persistencia sobre entidades de negocio: incumplen R-DOM-01. El modelo de persistencia vive en infraestructura y se mapea (R-INF-02).
- Arranque y contenedor de inyección: raíz de composición. Si el proyecto usa un *middleware* o filtro global de errores, se registra en platform y la traducción vive en presentación.

En todos los casos, `docs/ARCHITECTURE.md` nombra la ruta impuesta, su rol y la restricción. Si hace falta saltarse un INV, la excepción se escribe ahí.
