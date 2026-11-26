> Extra de último recurso (v1.3). Primero: `SKILL.md` y `references/`. No abras este fichero de entrada.

# Arquitectura en capas · Guía (v1.3)

90 reglas. Plantillas en las references; mapa en `ARCHITECTURE.template.md`.

**Núcleo (INV).** Cuatro capas, dependencias hacia dentro, dominio sin E/S, puertos, presentación sin negocio, mapeo, raíz de composición. Sin eso, no es esta skill.

**Normas de código (DEF y CONV).** RORO, `Result` u otra política, nombres, tests, frameworks, detalle de errores y de flujo. El proyecto las pisa en `docs/ARCHITECTURE.md` o `docs/STYLE.md` sin tocar el núcleo.

## Cómo leer

**DEBE:** obligatorio. **DEBERÍA:** desviación documentada en `docs/ARCHITECTURE.md`. **PUEDE:** opcional. Cada regla tiene un ID y etiqueta INV, DEF o CONV. TypeScript es notación. Prioridad: petición > mapa > framework > `SKILL.md` > esta guía. Si la petición obliga a incumplir un DEBE, R-AGT-05.

---



## 1. Protocolo de ejecución

Orden: mapa → vecinos → clasificar (2.3) → ubicar → de dentro hacia fuera (9.1) → checklist de `SKILL.md` → DEBERÍA desviados.

- **R-AGT-01 (INV)** — Antes de crear o modificar archivos, el agente DEBE leer el mapa de capas del proyecto. Si no existe, DEBE inferirlo del árbol existente (sección 3.2), dejar constancia de la inferencia y, si el flujo es interactivo, confirmarla antes de generar código.
- **R-AGT-02 (INV)** — El agente NO DEBE mover, renombrar ni reorganizar archivos o carpetas existentes, ni crear una estructura paralela a la del proyecto, salvo que se le pida de forma explícita.
- **R-AGT-03 (DEF)** — Todo archivo nuevo DEBE ubicarse donde el mapa de capas indique para su capa y DEBE imitar a los archivos vecinos de esa capa: convención de nombres, mayúsculas y minúsculas, extensión, forma de exportar y ubicación de las pruebas. Imita la forma, no los incumplimientos de reglas que tengan.
- **R-AGT-04 (DEF)** — El agente NO DEBE añadir frameworks ni librerías nuevos para cumplir esta guía cuando el proyecto ya cubre esa necesidad (validación, inyección de dependencias, acceso a datos, logs). Si falta una capacidad, DEBE proponerla antes de añadirla.
- **R-AGT-05 (INV)** — Si una petición obliga a incumplir una regla DEBE, el agente DEBE señalarlo y proponer una alternativa antes de generar el código.
- **R-AGT-06 (CONV)** — Al revisar código, el agente DEBE citar las reglas incumplidas por su identificador.
- **R-AGT-07 (INV)** — Cuando el framework imponga la ubicación o la forma de un archivo, el agente DEBE respetar esa imposición y aplicar la regla R-EST-08.

---



## 2. Modelo



### 2.1 Capas

Núcleo. Invertida: `presentación → aplicación → dominio ← infraestructura`. Shared es transversal. La raíz de composición conecta; no es capa.


| Capa            | Responsabilidad                                                               | No contiene                          |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| Presentación    | Recibir, validar forma, mapear, invocar un caso de uso, traducir al protocolo | Negocio, datos, transacciones        |
| Aplicación      | Orquestar, transacción, autorización                                          | Negocio, persistencia, protocolo     |
| Dominio         | Conceptos y reglas del negocio                                                | E/S, frameworks, reloj, azar         |
| Infraestructura | Implementar puertos                                                           | Negocio, orquestación                |
| Shared          | Piezas genéricas sin negocio                                                  | Negocio, E/S, imports de otras capas |
| Platform        | Infraestructura técnica común                                                 | Negocio                              |




### 2.2 Matriz de imports permitidos

Fila = quien importa. Entre módulos, solo la API pública (R-EST-02).


| Desde \ Hacia       | Presentación | Aplicación   | Dominio                    | Infraestructura          | Shared | Platform |
| ------------------- | ------------ | ------------ | -------------------------- | ------------------------ | ------ | -------- |
| Presentación        | —            | Sí           | **No**                     | **No**                   | Sí     | Sí       |
| Aplicación          | **No**       | —            | Sí                         | **No** (solo interfaces) | Sí     | **No**   |
| Dominio             | **No**       | **No**       | —                          | **No**                   | Sí     | **No**   |
| Infraestructura     | **No**       | Sí (puertos) | Sí                         | —                        | Sí     | Sí       |
| Shared              | **No**       | **No**       | **No**                     | **No**                   | —      | **No**   |
| Platform            | **No**       | Sí (puertos) | **No**                     | **No**                   | Sí     | —        |
| Raíz de composición | Sí           | Sí           | Sí                         | Sí                       | Sí     | Sí       |


- **R-GEN-01 (INV)** — Las capas de presentación, aplicación, dominio e infraestructura DEBEN ser cerradas. La única excepción permitida es la de las consultas de solo lectura descritas en R-FLU-07.
- **R-GEN-02 (INV)** — El código común (shared) es la única capa abierta: cualquier capa PUEDE usarlo.
- **R-GEN-04 (INV)** — Las dependencias NO DEBEN formar ciclos, ni entre capas ni entre módulos.
- **R-GEN-06 (DEF)** — Dentro de una capa, una unidad (caso de uso, controlador, servicio, repositorio, cliente) NO DEBE llamar a otra unidad de la misma capa. Si dos necesitan lo mismo, se extrae una función general a shared (a platform si es técnica y la capa puede usarla) y ambas la usan; si es negocio, lo coordina la capa superior. Quedan fuera las piezas del modelo de dominio entre sí (una entidad usa sus value objects) y los métodos privados de la misma unidad.
- **R-FLU-01 (INV)** — El flujo de llamadas DEBE ser presentación → aplicación → dominio. La aplicación llama a la infraestructura solo a través de interfaces.
- **R-FLU-02 (INV)** — Una capa interior NO DEBE conocer el tipo concreto de una capa exterior. Los `import` solo DEBEN apuntar a las capas permitidas por la matriz de la sección 2.2.
- **R-FLU-08 (INV)** — Las dependencias concretas DEBEN crearse y conectarse solo en la raíz de composición (o en el contenedor de inyección del framework). Las capas NO DEBEN instanciar sus propias dependencias.



### 2.3 Tabla de decisión de capa

La primera afirmativa decide. El mapa da la ruta.


| #   | ¿El código…?                                             | Capa                |
| --- | -------------------------------------------------------- | ------------------- |
| 1   | …recibe el exterior o produce la salida del cliente?     | Presentación        |
| 2   | …habla con algo externo para leer o escribir?            | Infraestructura     |
| 3   | …es una regla de negocio cierta sin ordenador?           | Dominio             |
| 4   | …coordina pasos o define una transacción?                | Aplicación          |
| 5   | …es genérico, puro, sin negocio, útil en varios módulos? | Shared              |
| 6   | …crea y conecta instancias concretas?                    | Raíz de composición |


Equivalencias: `references/frameworks.md`.

### 2.4 Variante e intensidad

La skill se aplica a cualquier proyecto que la use. La variante se elige por lo que hace el código, por módulo:

- **Ligera:** CRUD sencillo, sin reglas de negocio (recibir, validar la forma, guardar y leer). Sin capa de dominio propia. Validar tipos, formatos u obligatorios es forma, no negocio.
- **Completa:** en cuanto hay una regla de negocio, es decir, una comprobación que solo tiene sentido si se conoce el negocio («una sesión no se cierra antes de empezar»).
- Si no está claro, pregunta a la persona. Si no puedes preguntar, usa la ligera y anótalo en `docs/ARCHITECTURE.md`; el módulo pasa a completa con su primera regla de negocio (**R-GEN-05**).
- Varios subdominios con poco en común: módulos y, dentro, capas, sobre la estructura existente.


| Aspecto                   | Ligera                                                          | Completa                            |
| ------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| Capas                     | Presentación, servicios (aplicación + dominio), infraestructura | Las cuatro                          |
| Interfaces de repositorio | Opcionales                                                      | Obligatorias                        |
| Modelo                    | Datos + funciones                                               | Entidades, value objects, agregados |
| DTO                       | Solo frontera exterior                                          | Todas las fronteras                 |


Mal uso: reenvíos, un campo en seis archivos, entidades sin comportamiento, saltar capas, tocar todas las capas de todos los módulos.

- **R-GEN-03 (DEF)** — Un proyecto nuevo DEBERÍA usar la variante invertida. Si usa la clásica (dominio → persistencia), DEBE documentarlo y aplicar el resto de reglas sustituyendo «interfaz de repositorio» por «repositorio concreto».
- **R-GEN-05 (INV)** — La variante ligera DEBE mantener separadas, al menos, la presentación y la infraestructura, y DEBE aplicar las reglas de errores INV. El paso de la variante ligera a la completa PUEDE hacerse módulo a módulo.



### 2.5 Reglas por capa

**Presentación**

- **R-PRE-01 (INV)** — La presentación DEBE validar la forma de la entrada (tipos, formatos, campos obligatorios, longitudes) antes de llamar a la aplicación.
- **R-PRE-02 (INV)** — La presentación NO DEBE contener reglas de negocio. Una comprobación que solo tiene sentido si se conoce el negocio («un pedido confirmado no se puede editar») pertenece al dominio.
- **R-PRE-03 (DEF)** — Cada operación de presentación (endpoint, comando, acción de pantalla) DEBERÍA invocar exactamente un caso de uso.
- **R-PRE-04 (INV)** — La presentación NO DEBE importar nada de infraestructura ni del dominio. Lo que necesita (DTO, tipo de error de dominio) lo recibe de la aplicación.
- **R-PRE-05 (INV)** — Los detalles del protocolo (códigos HTTP, cabeceras, códigos de salida de CLI, navegación de UI) DEBEN quedarse en la presentación.

**Aplicación**

- **R-APL-01 (DEF)** — Cada caso de uso DEBE representar una intención del usuario o del sistema y nombrarse con un verbo: `AddOrderLine`, `RegisterUser`, `CancelReservation`.
- **R-APL-02 (CONV)** — Un caso de uso DEBE recibir un único objeto de entrada inmutable (comando o consulta) y devolver un DTO o un `Result` con un DTO. El objeto de entrada sigue RORO (R-PAR-09).
- **R-APL-03 (INV)** — La aplicación DEBE acceder a la infraestructura solo a través de interfaces (puertos o repositorios), recibidas por inyección.
- **R-APL-04 (DEF)** — Un caso de uso NO DEBERÍA llamar a otro caso de uso. La lógica compartida se extrae a un servicio de dominio o, si es genérica, a shared. Caso particular de R-GEN-06.
- **R-APL-05 (INV)** — La transacción DEBE abrirse y cerrarse en la aplicación, una por caso de uso, mediante una unidad de trabajo.
- **R-APL-06 (INV)** — La autorización («¿puede este usuario hacer esto?») DEBE comprobarse en la aplicación. La autenticación («¿quién es?») se resuelve en la presentación.

**Dominio**

- **R-DOM-01 (INV)** — El dominio NO DEBE importar código de presentación, aplicación ni infraestructura, ni tampoco frameworks o librerías de entrada y salida.
- **R-DOM-02 (DEF)** — Las invariantes de una entidad DEBEN protegerse dentro de la propia entidad: no puede existir una instancia en estado inválido. Aplica a la variante completa.
- **R-DOM-03 (CONV)** — Las entidades NO DEBEN exponer *setters* públicos. El estado cambia solo mediante métodos con nombre de negocio (`confirm()`, `addLine()`).
- **R-DOM-04 (CONV)** — Los conceptos con reglas propias (dinero, email, cantidad, rango de fechas) DEBERÍAN modelarse como value objects en lugar de como primitivos.
- **R-DOM-05 (DEF)** — En la variante completa, el dominio DEBE definir las interfaces de repositorio de sus agregados, expresadas en términos de dominio y no de tablas. En la ligera son opcionales (tabla 2.4).

**Infraestructura**

- **R-INF-01 (INV)** — Toda clase de infraestructura que se use desde capas interiores DEBE implementar una interfaz definida en el dominio o en la aplicación.
- **R-INF-02 (INV)** — Los modelos de persistencia (filas, entidades ORM, documentos) NO DEBEN salir de la infraestructura. Se convierten a tipos de dominio con un *mapper*.
- **R-INF-03 (INV)** — La infraestructura DEBE traducir los fallos del almacén que tienen significado de negocio (duplicado, clave ajena) a los códigos del catálogo de dominio, conservando la causa original. Los demás fallos salen como error técnico, sin inventar códigos de dominio.
- **R-INF-04 (DEF)** — Los reintentos, los *timeouts*, los *circuit breakers* y la caché DEBEN implementarse en infraestructura, de forma transparente para el resto.

**Shared**

- **R-SHR-01 (INV)** — Shared NO DEBE importar de ninguna otra capa ni de ningún módulo del proyecto.
- **R-SHR-02 (INV)** — Shared NO DEBE contener lógica de negocio. Si una utilidad solo la usa un módulo, vive en ese módulo.
- **R-SHR-03 (DEF)** — Shared NO DEBERÍA tener agrupaciones «cajón de sastre» (del tipo `utils` o `helpers`) sin un tema concreto. Cada agrupación tiene un propósito con nombre.
- **R-SHR-04 (DEF)** — La configuración DEBE leerse y validarse una sola vez, al arrancar, y entregarse a cada componente como un objeto tipado. Las capas interiores NO DEBEN leer variables de entorno directamente.

---



## 3. Estructura del proyecto

Las capas son roles, no nombres de carpeta. Cada archivo, una sola capa.

### 3.1 Mapa de capas

Vive en `docs/ARCHITECTURE.md` (plantilla: `assets/ARCHITECTURE.template.md`): glob de cada rol; módulo y API pública; rutas del framework; convenciones; variante, organización, política de errores (R-ERR-05), estilo de casos de uso (R-PAR-08); herramienta y comando de fronteras.

### 3.2 Inferir el mapa cuando no existe

Árbol → imposición del framework → rol vacío junto a piezas parecidas, sin niveles nuevos en la raíz → registrar y confirmar si es interactivo. Vacío y sin imposición: por módulo y capa, o solo por capa. Carpeta nueva: nombre habitual del stack; si no hay, el del rol.

### 3.3 Nombres

Patrón conceptual fijo; forma escrita la del proyecto. Controlador `OrderController`; esquema `AddLineRequestSchema`; caso de uso `AddOrderLine`; comando `AddOrderLineCommand`; DTO `OrderSummary`; puerto `Clock`; entidad `Order`; interfaz `OrderRepository`; concreto `SqlOrderRepository`; *mapper* `toOrderSummary`; código `ORDER_NOT_FOUND`. Detalle: `references/names-and-folders.md`.

### 3.4 Reglas de estructura

- **R-EST-01 (INV)** — El proyecto DEBERÍA declarar su mapa de capas (sección 3.1). Sea cual sea su organización, DEBE aplicarla de forma uniforme en todos sus módulos.
- **R-EST-02 (INV)** — Un módulo NO DEBE importar archivos internos de otro módulo. Solo PUEDE usar lo que el otro expone en su API pública, normalmente casos de uso o DTO.
- **R-EST-03 (DEF)** — Cada caso de uso DEBERÍA vivir en su propia unidad (archivo, clase o función) e identificarse con el nombre del caso de uso, escrito según la convención de nombres del proyecto.
- **R-EST-04 (INV)** — La estructura de carpetas, el árbol de archivos y las convenciones de nombres del proyecto DEBEN respetarse. Esta guía NO DEBE usarse como motivo para mover, renombrar o reorganizar archivos existentes, ni para crear carpetas con los nombres de los ejemplos.
- **R-EST-05 (DEF)** — Los nombres de dominio y de casos de uso DEBEN usar el vocabulario del negocio. Los nombres técnicos (`Sql`, `Http`, `Redis`) DEBEN aparecer solo en infraestructura y en platform.
- **R-EST-06 (DEF)** — El proyecto DEBERÍA verificar en integración continua las reglas R-GEN-04, R-DOM-01, R-PRE-04, R-SHR-01 y R-EST-02 con una herramienta automática de análisis de dependencias del ecosistema del proyecto, configurada con contratos de capas y de importaciones prohibidas sobre las rutas del mapa.
- **R-EST-07 (INV)** — Cada archivo nuevo DEBE colocarse en la ubicación que el mapa de capas asigna a su capa. Si su capa no tiene ubicación en el mapa, se propone una (sección 3.2) antes de crearlo.
- **R-EST-08 (INV)** — Cuando el framework imponga la ubicación o la forma de un archivo (rutas basadas en ficheros, pantallas, migraciones, configuración), esa imposición prevalece. El archivo se clasifica por su rol y DEBE mantenerse delgado: delega en la capa que corresponda en lugar de contener lógica de otras capas.

---



## 4. Flujo de una operación



### 4.1 Secuencia de escritura

Exterior → presentación (forma) → aplicación (comando, transacción, autorización) → infraestructura (`find`) → dominio → infraestructura (`save`) → DTO por lista blanca → protocolo. Nada cruza una frontera sin mapeo.

### 4.2 Fases y orden por coste

1. Parámetros (presentación, sin E/S).
2. Lógica: memoria → almacenamiento propio → externos → escrituras. Autorización primero si el orden revelaría información.
3. Saneamiento: lista blanca, sin internos.

- **R-FLU-10 (CONV)** — Toda operación DEBE ejecutar sus comprobaciones en tres fases y en este orden: (1) validar los parámetros, (2) validar la lógica, (3) sanear la respuesta. Una fase NO DEBE empezar si la anterior ha fallado.
- **R-FLU-11 (CONV)** — Dentro de la validación de la lógica, las comprobaciones DEBERÍAN ordenarse de menor a mayor coste: en memoria, almacenamiento propio, servicios externos y, al final, escrituras. Si ese orden revelara información a quien no tiene permiso, la autorización DEBE ir primero.
- **R-FLU-12 (CONV)** — La respuesta DEBE construirse por lista blanca: el DTO de salida enumera explícitamente cada campo. NO DEBE serializarse una entidad, un modelo de persistencia ni un objeto completo.
- **R-FLU-13 (DEF)** — El escapado o la codificación de la salida (HTML, CSV, *shell*) DEBE hacerse en presentación, según el destino, y no al guardar los datos.
- **R-FLU-14 (CONV)** — La entrada NO DEBE corregirse en silencio para hacerla válida: se valida y, si no cumple, se rechaza. Solo PUEDEN aplicarse las normalizaciones declaradas en el esquema, como recortar espacios o pasar un email a minúsculas.



### 4.3 Objetos en cada frontera


| Frontera                     | Entra                           | Sale                      | Mapea                     |
| ---------------------------- | ------------------------------- | ------------------------- | ------------------------- |
| Exterior → Presentación      | Carga útil                      | DTO de petición           | Presentación              |
| Presentación → Aplicación    | Comando inmutable               | DTO o error               | Presentación / aplicación |
| Aplicación ↔ Dominio         | Entidades, value objects        | Igual, errores de dominio | Aplicación                |
| Aplicación ↔ Infraestructura | Tipos de dominio vía interfaces | Tipos de dominio          | Infraestructura           |
| Presentación → Exterior      | DTO o error                     | Protocolo                 | Presentación              |


- **R-FLU-03 (INV)** — Las entidades de dominio NO DEBERÍAN salir de la capa de aplicación. La presentación recibe DTO de salida.
- **R-FLU-04 (CONV)** **R-PAR-03 (CONV)** — Los comandos, las consultas, los DTO, los value objects y los eventos DEBEN ser inmutables y contener solo datos, sin comportamiento. Una operación sobre ellos devuelve una instancia nueva.
- **R-FLU-05 (DEF)** — Cada *mapper* DEBE vivir en la capa exterior de la frontera que traduce y DEBE ser una función pura.



### 4.4 Transacciones, lecturas y eventos

- **R-FLU-06 (DEF)** — Si un caso de uso devuelve un error esperado, la unidad de trabajo DEBE descartar los cambios. Si lanza una excepción, DEBE revertirlos.
- **R-FLU-07 (DEF)** — Las consultas de solo lectura PUEDEN resolverse con un servicio de consulta (*query service*) definido como interfaz en la aplicación e implementado en infraestructura, que devuelve DTO directamente sin pasar por entidades de dominio. Las operaciones de escritura NO DEBEN usar este atajo.
- **R-FLU-09 (DEF)** — El dominio DEBE limitarse a registrar eventos. La publicación DEBE hacerla la aplicación, a través de un puerto, después de confirmar la transacción. Si la entrega tiene que estar garantizada, la infraestructura DEBERÍA usar el patrón *outbox*.

---



## 5. Errores

Alcance: errores de dominio, más cinco mínimos de seguridad que valen en toda la arquitectura. La traducción a HTTP u otro protocolo, el formato de respuesta, los logs, la trazabilidad y los errores técnicos los decide el proyecto en `docs/ARCHITECTURE.md`.

### 5.1 Modelo

| Campo | Qué es | Ejemplo |
| --- | --- | --- |
| `kind` | Categoría, de un conjunto cerrado | `VALIDATION` |
| `code` | Identificador estable `etiqueta.razón` | `session.end_at.order` |
| `message` | Texto del catálogo; puede cambiar | `session.end_at debe ser posterior a session.start_at` |
| `entity`, `field` | Opcionales, salen de la etiqueta | `session`, `end_at` |
| `cause` | Error original, si lo hay | — |

`kind` base: `VALIDATION`, `NOT_FOUND` y `CONFLICT`; el proyecto puede añadir otros. Catálogo en el dominio (uno por módulo si hay módulos), con etiquetas y razones cerradas. Una sola fábrica construye el error; con excepciones puede haber un atajo que construye y lanza. Forma de entregarlos: la del proyecto; si no hay nada, la natural del lenguaje.

### 5.2 Qué hace cada capa

Dominio crea con la fábrica y no captura. Aplicación usa los mismos códigos (`session.missing`). Infraestructura traduce los fallos del almacén con significado de negocio a esos códigos y conserva la causa; el resto es técnico. Presentación decide según `kind` y `code` y recibe el tipo desde la aplicación; la forma la define el proyecto.

### 5.3 Reglas

- **R-ERR-01 (INV)** — Todo fallo de negocio DEBE ser un error de dominio tomado del catálogo, con una categoría (`kind`) de un conjunto cerrado y un código (`code`) estable.
- **R-ERR-02 (CONV)** — El `code` DEBE tener la forma `etiqueta.razón`, salir del catálogo y ser estable. El texto de `message` puede cambiar en el catálogo; cambiar un `code` publicado es un cambio incompatible.
- **R-ERR-03 (INV)** — Cuando se crea un error a partir de otro, DEBE conservarse el original en `cause`.
- **R-ERR-04 (INV)** — Los datos de un error (`message` y cualquier campo extra) NO DEBEN contener secretos, contraseñas, *tokens* ni datos personales sensibles.
- **R-ERR-05 (INV)** — El proyecto DEBE usar una única forma de entregar los errores de dominio en todos sus módulos y declararla en `docs/ARCHITECTURE.md`. Si no hay nada decidido, DEBE usar el mecanismo natural del lenguaje: excepciones donde son lo habitual y valores de error donde lo son.
- **R-ERR-07 (CONV)** — NO DEBE devolverse `null`, `undefined`, `-1` ni `false` para indicar un error. `null` solo significa ausencia legítima (por ejemplo, `findById` sin resultado), y la capa que lo recibe decide si eso es un `NOT_FOUND`.
- **R-ERR-09 (INV)** — NO DEBE haber bloques `catch` vacíos ni bloques que lo capturen todo sin traducir ni relanzar.
- **R-ERR-10 (INV)** — El dominio NO DEBE conocer códigos HTTP, códigos de salida ni textos de interfaz.
- **R-ERR-11 (CONV)** — Las decisiones y los textos que ve el usuario final DEBEN basarse en `kind` y `code`, mediante un catálogo de mensajes o i18n. NO DEBEN depender del texto de `message`.
- **R-ERR-12 (INV)** — Ningún error que llegue al cliente DEBE incluir trazas de pila, SQL, nombres de tablas, *hosts* ni mensajes de librerías.
- **R-ERR-14 (DEF)** — Las reglas de negocio NO DEBEN reimplementarse en presentación. Si la interfaz las repite para dar una respuesta inmediata al usuario, el dominio sigue siendo la fuente de verdad y siempre vuelve a comprobarlas. Véase R-PRE-02.
- **R-ERR-16 (INV)** — Los logs NO DEBEN contener contraseñas, *tokens*, números de tarjeta ni datos personales sin enmascarar.
- **R-ERR-17 (DEF)** — Un fallo de negocio DEBE crearse con la única fábrica del proyecto, que recibe etiqueta y razón y consulta el catálogo. NO DEBE escribirse el mensaje en el punto de fallo ni crearse un error ad hoc. Con excepciones PUEDE haber un atajo que construye y lanza, siempre a través de la fábrica.

---



## 6. Paradigmas y firmas

Normas de código, salvo R-PAR-01 (dominio sin efectos: núcleo). El proyecto elige estilo de casos de uso y `Result` o excepciones.

Reglas y *mappers* puros; coordinación e I/O inyectadas. Efectos (E/S, reloj, azar, ids, estado global, env): fuera del dominio, o por parámetro o puerto.

- **R-PAR-01 (INV)** — El dominio DEBE estar libre de efectos secundarios. La hora, los identificadores y los valores aleatorios DEBEN llegar como parámetros o a través de puertos inyectados.
- **R-PAR-02 (CONV)** — Los cálculos, las reglas sin estado, las validaciones y los mapeos DEBEN implementarse como funciones puras.
- **R-PAR-04 (CONV)** — Las entidades PUEDEN tener estado mutable, pero ese estado solo DEBE cambiar a través de métodos que comprueben sus invariantes. Sus colecciones internas NO DEBEN exponerse de forma mutable.
- **R-PAR-05 (CONV)** — Los componentes con dependencias (controladores, casos de uso, repositorios, clientes) DEBEN recibirlas desde fuera: por constructor si son objetos, o como argumento de una función fábrica si son funciones. NO DEBEN usar *singletons* globales ni localizadores de servicios.
- **R-PAR-06 (CONV)** — La herencia DEBERÍA limitarse a la jerarquía de errores y a lo que exija el framework. Para reutilizar comportamiento se prefieren la composición o las funciones.
- **R-PAR-07 (DEF)** — El estado compartido mutable (cachés, *pools*, contadores) solo PUEDE existir en infraestructura o en platform, y DEBE ser seguro ante la concurrencia.
- **R-PAR-08 (CONV)** — Un proyecto DEBE elegir un estilo único para construir los casos de uso (clases o funciones fábrica) y aplicarlo en todos los módulos. El estilo se registra en `docs/ARCHITECTURE.md`.

RORO: un objeto de entrada; varios valores de salida, un objeto con nombre.

- **R-PAR-09 (CONV)** — Los casos de uso, los métodos de puertos con más de un parámetro y las fábricas de entidades y value objects con más de dos campos DEBEN seguir RORO: un único objeto de entrada, tipado e inmutable.
- **R-PAR-10 (CONV)** — Cualquier otra función DEBERÍA seguir RORO cuando tenga tres o más parámetros, algún parámetro booleano, parámetros opcionales o dos o más parámetros del mismo tipo.
- **R-PAR-11 (CONV)** — RORO NO DEBERÍA usarse en funciones puras de uno o dos parámetros con significado evidente, en *callbacks* de `map` / `filter` / `reduce` ni en código de rendimiento crítico.
- **R-PAR-12 (CONV)** — El objeto de entrada DEBE tener un tipo con nombre que distinga los campos obligatorios de los opcionales, y los valores por defecto DEBEN declararse en un único sitio (la firma o el esquema).
- **R-PAR-13 (CONV)** — Una función DEBERÍA devolver un objeto con nombre cuando produce más de un valor o cuando es previsible que su salida crezca. Si devuelve un único valor de significado evidente, PUEDE devolver un primitivo.

Equivalencias: `references/paradigm-and-signatures.md`.

---



## 7. Pruebas

Norma de código. El marco es el del proyecto. Detalle: `references/tests.md`.


| Capa            | Tipo                      | Dobles             | Verifica                         |
| --------------- | ------------------------- | ------------------ | -------------------------------- |
| Dominio         | Unitarias                 | Ninguno            | Reglas, errores de dominio       |
| Aplicación      | Caso de uso               | *Fakes* en memoria | Orquestación, transacción        |
| Infraestructura | Integración               | Tecnología real    | Consultas, traducción de errores |
| Presentación    | Contrato                  | Caso de uso *stub* | Validación, formato              |
| Sistema         | Extremo a extremo (pocas) | Ninguno            | Flujos críticos                  |
| Arquitectura    | Imports                   | —                  | Fronteras (R-EST-06)             |


- **R-TST-01 (DEF)** — Toda regla de negocio del dominio DEBE tener al menos una prueba unitaria sin dobles.
- **R-TST-02 (CONV)** — Las pruebas de aplicación DEBERÍAN usar *fakes* en memoria que implementen las interfaces reales, en lugar de *mocks* que verifican llamadas internas.
- **R-TST-03 (DEF)** — Cada implementación de repositorio DEBE tener pruebas de integración contra la tecnología real, incluida la traducción de errores (R-INF-03).
- **R-TST-04 (DEF)** — Cada código de error esperado de un caso de uso DEBERÍA tener una prueba que lo provoque.
- **R-TST-05 (CONV)** — Las pruebas DEBERÍAN ubicarse según la convención del proyecto (junto al código o en un árbol paralelo). Si no hay convención, DEBERÍAN reproducir la estructura del código que prueban.

---



## 8. Plantillas de código

Están en `references/errors.md`, `references/flow-and-validation.md` y `references/paradigm-and-signatures.md`. Adáptalas al lenguaje del proyecto.

---



## 9. Implementación y verificación

De dentro hacia fuera. Cada paso compila y tiene pruebas. Cada archivo, donde diga el mapa.

1. Dominio: reglas, catálogo, pruebas sin dobles.
2. Aplicación: comando, DTO, caso de uso, puerto, *fakes*.
3. Infraestructura: implementación, traducción de errores, integración.
4. Presentación: esquema, operación delgada, *presenter*. El framework manda la ruta.
5. Composición: conectar en la raíz.

Proyecto nuevo, antes del 1: variante, organización, política de errores y estilo de casos de uso en `docs/ARCHITECTURE.md`; mapa; shared y platform; fronteras. Después: lo que el proyecto decida para logs y métricas.

Checklist: `SKILL.md`.

---



## 10. Antipatrones


| Antipatrón                    | Síntoma                                       | Corrección                                |
| ----------------------------- | --------------------------------------------- | ----------------------------------------- |
| Controlador gordo             | Reglas o SQL en el controlador                | Caso de uso + dominio (R-PRE-02)          |
| Modelo anémico                | Entidades con *setters*; negocio en servicios | Reglas en la entidad (R-DOM-02, R-DOM-03) |
| Fuga del ORM                  | Entidad ORM como dominio o API                | *Mapper* (R-INF-02)                       |
| Repositorio genérico          | SQL o filtros arbitrarios                     | Métodos con intención (R-DOM-05)          |
| *Sinkhole*                    | Caso de uso que solo reenvía                  | Ligera o consulta (R-FLU-07)              |
| Lasaña                        | Abstracciones de más                          | Cuatro capas como máximo                  |
| Shared cajón de sastre        | `utils` con negocio                           | Devolver al módulo (R-SHR-02, R-SHR-03)   |
| Servicio dios                 | Decenas de métodos                            | Un caso de uso por unidad (R-EST-03)      |
| Configuración dispersa        | `env` por todo el código                      | Validar al arrancar (R-SHR-04)            |
| Dominio con reloj             | `new Date()` en entidades                     | Parámetro o puerto (R-PAR-01)             |
| Decidir por `message`         | Lógica según el texto                         | Decidir por `code` (R-ERR-11)             |
| Reestructuración por la guía  | Carpetas movidas para imitar ejemplos         | Mapa sobre lo existente (R-EST-04)        |
| Lógica en el framework        | Negocio en la ruta o la pantalla              | Delgado y delegar (R-EST-08)              |


