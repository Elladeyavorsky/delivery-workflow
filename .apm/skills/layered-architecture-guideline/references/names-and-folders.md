# Nombres y carpetas

Se lee para inferir el mapa cuando falta y para el patrón de nombres. El mapa vive en `docs/ARCHITECTURE.md`. Las capas son roles, no nombres de carpeta. La estructura física es la del proyecto; se respeta (R-AGT-02, R-EST-04). Cada archivo se asigna a una sola capa.

## Inferir el mapa

Base de R-AGT-01. Si `docs/ARCHITECTURE.md` ya existe, añade las secciones de `assets/ARCHITECTURE.template.md` que falten; conserva texto y rutas. No sustituyas el fichero ni reorganices carpetas para imitar ejemplos.

Si no existe `docs/ARCHITECTURE.md`:

1. Recorre el árbol e identifica qué rutas ya cumplen cada rol (controladores o pantallas, acceso a datos, reglas).
2. Identifica las rutas que impone el framework y las convenciones de nombres que ya se usan.
3. Para un rol sin ubicación, propone la más coherente con lo existente y evita niveles nuevos en la raíz. Si hace falta una carpeta nueva (por ejemplo, para shared o platform), usa el nombre habitual del stack (`core/`, `lib/`, `internal/`...); si no hay ninguno, el del rol (`shared/`, `platform/`). Anótala en el mapa.
4. Registra el mapa inferido en `docs/ARCHITECTURE.md` y, si el flujo es interactivo, confírmalo.
5. Solo si el proyecto está vacío y el framework no impone nada puedes usar, de referencia: por módulo y capa (`modules/<módulo>/{presentation,application,domain,infrastructure}` + `shared/` + `platform/`) o solo por capa.

Las desviaciones se escriben en «Excepciones y decisiones» de `docs/ARCHITECTURE.md`.

## Nombres

El patrón conceptual es fijo; la forma escrita (mayúsculas, separadores, sufijos, extensión) es la del proyecto. Si el proyecto ya usa otros sufijos para el mismo rol (`Handler`, `Service`), se mantienen.

| Artefacto | Capa | Patrón | Ejemplo |
| --- | --- | --- | --- |
| Controlador / *handler* | Presentación | Concepto + rol | `OrderController` |
| Esquema de entrada | Presentación | Operación + `RequestSchema` | `AddLineRequestSchema` |
| Caso de uso | Aplicación | Verbo + objeto | `AddOrderLine` |
| Comando / consulta | Aplicación | Caso de uso + `Command` / `Query` | `AddOrderLineCommand` |
| DTO de salida | Aplicación | Sustantivo | `OrderSummary` |
| Puerto | Aplicación | Capacidad | `ProductCatalog`, `Clock` |
| Entidad / value object | Dominio | Sustantivo del negocio | `Order`, `Money` |
| Interfaz de repositorio | Dominio | Agregado + `Repository` | `OrderRepository` |
| Repositorio concreto | Infraestructura | Tecnología + interfaz | `SqlOrderRepository` |
| *Mapper* | Capa exterior de la frontera | `to` + destino, o origen + `Mapper` | `toOrderSummary` |
| Código de error | Dominio del módulo | `MÓDULO_MOTIVO` | `ORDER_NOT_FOUND` |

- **R-APL-01 (DEF)** Cada caso de uso DEBE representar una intención del usuario o del sistema y nombrarse con un verbo: `AddOrderLine`, `RegisterUser`, `CancelReservation`.
- **R-SHR-03 (DEF)** Shared NO DEBERÍA tener agrupaciones «cajón de sastre» (del tipo `utils` o `helpers`) sin un tema concreto. Cada agrupación tiene un propósito con nombre.
- **R-EST-03 (DEF)** Cada caso de uso DEBERÍA vivir en su propia unidad (archivo, clase o función) e identificarse con el nombre del caso de uso, escrito según la convención de nombres del proyecto.
- **R-EST-05 (DEF)** Los nombres de dominio y de casos de uso DEBEN usar el vocabulario del negocio. Los nombres técnicos (`Sql`, `Http`, `Redis`) DEBEN aparecer solo en infraestructura y en platform.
