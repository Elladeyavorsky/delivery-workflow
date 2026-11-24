# Tests

Se lee para qué prueba cada capa y dónde viven las pruebas. Usa el marco que ya tenga el proyecto.

| Capa | Tipo | Dobles | Verifica |
| --- | --- | --- | --- |
| Dominio | Unitarias puras (por propiedades si son cálculos) | Ninguno | Reglas, invariantes, errores de dominio |
| Aplicación | Unitarias de caso de uso | *Fakes* en memoria de los puertos | Orquestación, resultado, estado, errores esperados, transacción |
| Infraestructura | Integración | Tecnología real en un contenedor o entorno efímero | Consultas, mapeos de ida y vuelta, traducción de errores (R-INF-03) |
| Presentación | Contrato o API | Caso de uso sustituido por un *stub* | Validación, códigos de estado, formato de respuesta y de error |
| Sistema | Extremo a extremo (pocas) | Ninguno | Flujos críticos |
| Arquitectura | Reglas de importación | — | Fronteras (R-EST-06) |

### Herramientas de verificación de fronteras (ejemplos)

Elige la que el proyecto ya use; si no hay ninguna, propón una del ecosistema y regístrala en `docs/ARCHITECTURE.md`.

- dependency-cruiser o eslint-plugin-boundaries (JavaScript/TypeScript)
- import-linter (Python)
- ArchUnit (Java/Kotlin)
- golangci-lint con depguard o go-arch-lint (Go)
- NetArchTest (.NET)
- deptrac (PHP)

Sin herramienta posible, revisa a mano con la checklist (R-AGT-06) y di que las fronteras no se comprobaron automáticamente.

- **R-TST-01 (DEF)** Toda regla de negocio del dominio DEBE tener al menos una prueba unitaria sin dobles.
- **R-TST-02 (CONV)** Las pruebas de aplicación DEBERÍAN usar *fakes* en memoria que implementen las interfaces reales, en lugar de *mocks* que verifican llamadas internas.
- **R-TST-03 (DEF)** Cada implementación de repositorio DEBE tener pruebas de integración contra la tecnología real, incluida la traducción de errores (R-INF-03).
- **R-TST-04 (DEF)** Cada código de error esperado de un caso de uso DEBERÍA tener una prueba que lo provoque.
- **R-TST-05 (CONV)** Las pruebas DEBERÍAN ubicarse según la convención del proyecto (junto al código o en un árbol paralelo). Si no hay convención, DEBERÍAN reproducir la estructura del código que prueban.
