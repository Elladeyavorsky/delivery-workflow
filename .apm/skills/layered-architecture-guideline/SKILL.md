---
name: layered-architecture-guideline
description: "Arquitectura en capas: invariantes, ubicación, nombres y separación de responsabilidades. Úsala al crear un proyecto, añadir una funcionalidad, decidir dónde va un archivo, cómo se nombra o cómo se separa algo."
---

# Skill: Layered architecture guideline

## 1. Perfil y Rol

- **Rol:** Estándar de arquitectura en capas.
- **Objetivo:** Cada pieza tiene capa, ruta y frontera.
- **Tono:** Neutro, en español.

## 2. Contexto y Alcance

- **Cuándo actuar:** Crear un proyecto, añadir una funcionalidad, decidir capa, nombre o separación.
- **Precedencia:** Petición de la persona > `docs/ARCHITECTURE.md` y `docs/STYLE.md` > framework > esta skill. Un INV solo se salta con excepción escrita en `docs/ARCHITECTURE.md`.

Carpeta: opencode, Cursor y Codex `.agents/skills/layered-architecture-guideline`; Claude Code `${CLAUDE_SKILL_DIR}`.

## 3. Flujo de Trabajo (Paso a Paso)

1. **Leer el mapa.** `docs/ARCHITECTURE.md` y `docs/STYLE.md`. Si falta el primero, créalo desde `<carpeta de esta skill>/assets/ARCHITECTURE.template.md` (infiere con `references/names-and-folders.md`). Si existe, completa las secciones que falten; no lo sustituyas. **R-AGT-01 (INV)**. El proyecto declara mapa y decisiones en `docs/ARCHITECTURE.md`. **R-EST-01 (INV)**.
2. **Decidir la capa** con la tabla. El archivo nuevo va donde el mapa indica (**R-EST-07 (INV)**) e imita la forma de los vecinos, no sus incumplimientos (**R-AGT-03 (DEF)**). No reorganices lo existente ni crees una estructura paralela, salvo petición explícita (**R-AGT-02 (INV)**, **R-EST-04 (INV)**).
3. **Frameworks.** Protocolo de la sección 4 (**R-AGT-07 (INV)**, **R-EST-08 (INV)**).
4. **Implementar** de dentro hacia fuera: dominio, aplicación, infraestructura, presentación, raíz de composición. Detalle: `references/flow-and-validation.md`, `references/errors.md` y `references/tests.md`. No añadas librerías que el proyecto ya cubre (**R-AGT-04 (DEF)**). Si la petición obliga a incumplir un DEBE, señálalo y propone una alternativa (**R-AGT-05 (INV)**).
5. **Comprobar** con la checklist. Al revisar, cita las reglas por ID (**R-AGT-06 (CONV)**). Fronteras: el `Comando` del mapa.

## 4. Reglas

### Invariantes

1. Cuatro capas —presentación, aplicación, dominio e infraestructura—, cada una con una responsabilidad, más shared transversal.
2. Dependencias solo hacia dentro, sin ciclos (**R-GEN-04 (INV)**). Las cuatro capas son cerradas (**R-GEN-01 (INV)**); shared es la única abierta (**R-GEN-02 (INV)**). Flujo presentación → aplicación → dominio; la aplicación llama a la infraestructura solo por interfaces (**R-FLU-01 (INV)**). Una capa interior no conoce tipos de una exterior; los imports siguen la matriz (**R-FLU-02 (INV)**). Un módulo solo usa la API pública de otro (**R-EST-02 (INV)**).
3. El dominio no hace entrada/salida ni importa frameworks (**R-DOM-01 (INV)**). Hora, azar e identificadores entran por parámetro o por puerto (**R-PAR-01 (INV)**).
4. La infraestructura implementa interfaces de dominio o aplicación (**R-INF-01 (INV)**). La aplicación solo la usa a través de ellas, inyectadas (**R-APL-03 (INV)**).
5. La presentación valida la forma (**R-PRE-01 (INV)**), traduce y no contiene negocio (**R-PRE-02 (INV)**; no se reimplementan ahí, **R-ERR-14**) ni importa infraestructura ni dominio; lo que necesita se lo da la aplicación (**R-PRE-04 (INV)**).
6. La aplicación orquesta el caso de uso y controla transacción (**R-APL-05 (INV)**) y autorización (**R-APL-06 (INV)**). La autenticación se resuelve en la presentación.
7. Nada cruza una frontera sin mapeo: ni entidades (**R-FLU-03 (INV)**) ni modelos de persistencia (**R-INF-02 (INV)**).
8. Las dependencias concretas se crean solo en la raíz de composición (**R-FLU-08 (INV)**).
9. El protocolo se queda en la presentación (**R-PRE-05 (INV)**). El dominio no lo conoce (**R-ERR-10 (INV)**).
10. Todo fallo de negocio es un error de dominio del catálogo, con categoría y código estables (**R-ERR-01 (INV)**). La infraestructura traduce los fallos del almacén a esos mismos códigos y el resto sale como error técnico (**R-INF-03 (INV)**). El proyecto declara una única forma de entregarlos; si no hay nada, la natural del lenguaje (**R-ERR-05 (INV)**).
11. Mínimos de seguridad en toda la arquitectura: toda traducción conserva la causa (**R-ERR-03 (INV)**); nada interno llega al cliente (**R-ERR-12 (INV)**); ni los detalles de un error ni los logs llevan secretos (**R-ERR-04 (INV)**, **R-ERR-16 (INV)**); ningún fallo se silencia (**R-ERR-09 (INV)**). El resto del manejo de errores fuera del dominio lo decide el proyecto.
12. Shared no tiene negocio (**R-SHR-02 (INV)**) ni importa de otras capas (**R-SHR-01 (INV)**).

### Capas y dónde va cada cosa

| Capa | Responsabilidad | No contiene |
| --- | --- | --- |
| Presentación | Validar forma, mapear, invocar un caso de uso, traducir al protocolo | Negocio, datos, transacciones |
| Aplicación | Orquestar, transacción, autorización | Negocio, persistencia, protocolo |
| Dominio | Conceptos y reglas del negocio | Entrada/salida, frameworks, reloj, azar |
| Infraestructura | Implementar puertos | Negocio, orquestación |
| Shared | Piezas genéricas sin negocio | Negocio, entrada/salida, imports de otras capas |

La raíz crea y conecta; no es una capa.

| Desde \ Hacia | Presentación | Aplicación | Dominio | Infraestructura | Shared | Platform |
| --- | --- | --- | --- | --- | --- | --- |
| Presentación | — | Sí | No | No | Sí | Sí |
| Aplicación | No | — | Sí | No, solo interfaces | Sí | No |
| Dominio | No | No | — | No | Sí | No |
| Infraestructura | No | Sí, puertos | Sí | — | Sí | Sí |
| Shared | No | No | No | No | — | No |
| Platform | No | Sí, puertos | No | No | Sí | — |
| Raíz de composición | Sí | Sí | Sí | Sí | Sí | Sí |

¿En qué capa va esto? La primera afirmativa decide. El mapa da la ruta.

1. Recibe el exterior o produce la salida del cliente → Presentación
2. Habla con algo externo para leer o escribir → Infraestructura
3. Regla de negocio cierta sin ordenador → Dominio
4. Coordina pasos o define una transacción → Aplicación
5. Genérico, puro, sin negocio, útil en varios módulos → Shared
6. Crea y conecta instancias concretas → Raíz de composición

### Intensidad y variante

La skill se aplica a cualquier proyecto que la use. La variante se elige por lo que hace el código, por módulo:

- **Ligera:** CRUD sencillo, sin reglas de negocio (recibir, validar la forma, guardar y leer). Sin capa de dominio propia. Validar tipos, formatos u obligatorios es forma, no negocio.
- **Completa:** en cuanto hay una regla de negocio, es decir, una comprobación que solo tiene sentido si se conoce el negocio («una sesión no se cierra antes de empezar»).
- Si no está claro, pregunta a la persona. Si no puedes preguntar, usa la ligera y anótalo en `docs/ARCHITECTURE.md`; el módulo pasa a completa con su primera regla de negocio (**R-GEN-05**).
- Varios subdominios con poco en común: módulos y, dentro, capas, sobre la estructura existente.

Ligera: presentación, servicios (aplicación + dominio) e infraestructura; repositorios opcionales; datos y funciones; transferencias solo en la frontera exterior. Completa: las cuatro capas; repositorios obligatorios; entidades y value objects; transferencias en todas las fronteras.

La ligera separa presentación e infraestructura y aplica las reglas de errores INV (**R-GEN-05 (INV)**). En la completa, el dominio define las interfaces de repositorio de sus agregados (**R-DOM-05 (DEF)**). Proyecto nuevo: variante invertida. La clásica se documenta en el mapa (**R-GEN-03 (DEF)**). Consultas de solo lectura: transferencias sin entidades; las escrituras no (**R-FLU-07 (DEF)**). Única excepción a **R-GEN-01**.

Señales: reenvíos, un campo en seis archivos, entidades sin comportamiento, saltar capas.

### Frameworks

1. Identifica lo que impone (rutas, pantallas, migraciones, arranque).
2. Clasifícalo como capa exterior.
3. Dominio y aplicación no importan nada del framework.

Casos: `references/frameworks.md`.

### Checklist final

- Archivo nuevo en capa y ruta del mapa (**R-EST-07**, **R-AGT-03**).
- Nada reorganizado sin petición (**R-EST-04**, **R-AGT-02**).
- Archivos que impone el framework, delgados (**R-EST-08**).
- Imports según la matriz; sin ciclos ni internos de otros módulos; sin llamadas entre unidades de una misma capa (**R-FLU-02**, **R-GEN-04**, **R-EST-02**, **R-DOM-01**, **R-PRE-04**, **R-SHR-01**, **R-GEN-06**).
- Una operación de presentación, un caso de uso; comando inmutable, éxito o error esperado (**R-PRE-03**, **R-APL-02**).
- Ni entidades ni persistencia salen de su capa; salida por lista blanca (**R-FLU-03**, **R-INF-02**, **R-FLU-12**).
- Transacción en aplicación; dependencias solo en la raíz (**R-APL-05**, **R-FLU-08**).
- Orden: parámetros, lógica de menor a mayor coste, saneamiento (**R-FLU-10**, **R-FLU-11**).
- Fallos de negocio con la fábrica y el catálogo de dominio; entregados según la política (**R-ERR-01**, **R-ERR-17**, **R-ERR-05**).
- Infraestructura traduce a los códigos del catálogo y conserva la causa; sin capturas vacías (**R-INF-03**, **R-ERR-03**, **R-ERR-09**).
- Nada interno ni sensible al cliente ni a los logs (**R-ERR-12**, **R-ERR-04**, **R-ERR-16**).
- Dominio sin efectos; value objects, transferencias y comandos inmutables; entidades sin mutadores públicos (**R-PAR-01**, **R-PAR-03**, **R-DOM-03**).
- Objeto único de entrada donde es obligatorio (**R-PAR-09**).
- Pruebas de cada regla nueva y código de error esperado (**R-TST-01**, **R-TST-04**).
- Sin librerías que el proyecto cubría (**R-AGT-04**).

## 5. Manejo de Errores y Excepciones

- Sin mapa, créalo; si existe, completa. Hueco: framework o fronteras.
- Framework que fusiona capas: ligera y excepción en el mapa.
- Sin herramienta de fronteras: «fronteras no comprobadas».
- Un DEBERÍA desviado, en el mapa.
- Guía: `<carpeta de esta skill>/assets/layered-architecture-guide.md`; no de entrada.
