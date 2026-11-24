---
name: layered-architecture-guideline
description: "Arquitectura en capas: invariantes, ubicación, nombres y separación de responsabilidades. Úsala al crear un proyecto, añadir una funcionalidad, decidir dónde va un archivo, cómo se nombra o cómo se separa algo. Fuera de alcance: scripts de un solo uso, ETL, sistemas por eventos, videojuegos, prototipos desechables."
---

# Skill: Layered architecture guideline

## 1. Perfil y Rol

- **Rol:** Estándar de arquitectura en capas para crear o cambiar un proyecto.
- **Objetivo Principal:** Cada pieza tiene capa, ruta y frontera.
- **Tono de Comunicación:** Neutro, en español.

## 2. Contexto y Alcance

- **Cuándo actuar:** Crear un proyecto, añadir una funcionalidad, decidir capa, nombre o separación.
- **Fuera de alcance:** Scripts de un solo uso, ETL, sistemas por eventos, videojuegos, prototipos desechables.
- **Precedencia:** Petición de la persona > `docs/ARCHITECTURE.md` y `docs/STYLE.md` > framework > esta skill. Un INV solo se salta con excepción escrita en `docs/ARCHITECTURE.md`.

La carpeta de esta skill es la que contiene este `SKILL.md`: en Claude Code, `${CLAUDE_SKILL_DIR}`; en Cursor y Codex, `.agents/skills/layered-architecture-guideline`.

## 3. Flujo de Trabajo (Paso a Paso)

1. **Leer el mapa.** `docs/ARCHITECTURE.md` y `docs/STYLE.md`. Si falta el primero, usa `<carpeta de esta skill>/assets/ARCHITECTURE.template.md`. Otro fichero de mapa del proyecto manda. Sin mapa: infiere, deja constancia y confirma si es interactivo (`references/nombres-y-carpetas.md`). **R-AGT-01 (INV)**. El proyecto declara mapa y decisiones en `docs/ARCHITECTURE.md`. **R-EST-01 (INV)**.
2. **Decidir la capa** con la tabla de la sección 4. El archivo nuevo va donde el mapa indica (**R-EST-07 (INV)**) e imita a los vecinos (**R-AGT-03 (DEF)**). No reorganices lo existente ni crees una estructura paralela, salvo petición explícita (**R-AGT-02 (INV)**, **R-EST-04 (INV)**).
3. **Frameworks.** Protocolo de la sección 4 (**R-AGT-07 (INV)**, **R-EST-08 (INV)**).
4. **Implementar** de dentro hacia fuera: dominio, aplicación, infraestructura, presentación, raíz de composición. Detalle: `references/flujo-y-validacion.md`, `references/paradigma-y-firmas.md`, `references/errores.md`, `references/tests.md`. No añadas librerías que el proyecto ya cubre (**R-AGT-04 (DEF)**). Si la petición obliga a incumplir un DEBE, señálalo y propone alternativa (**R-AGT-05 (INV)**).
5. **Comprobar** con la checklist. Al revisar, cita las reglas por su ID (**R-AGT-06 (CONV)**). Fronteras: `bash <carpeta de esta skill>/scripts/check-boundaries.sh`.

## 4. Reglas

### Invariantes

1. Cuatro capas —presentación, aplicación, dominio e infraestructura—, cada una con una sola responsabilidad, más shared transversal.
2. Dependencias solo hacia dentro, sin ciclos (**R-GEN-04 (INV)**). Las cuatro capas son cerradas (**R-GEN-01 (INV)**); shared es la única abierta (**R-GEN-02 (INV)**). Flujo presentación → aplicación → dominio; la aplicación llama a la infraestructura solo por interfaces (**R-FLU-01 (INV)**). Una capa interior no conoce tipos de una exterior; los imports siguen la matriz (**R-FLU-02 (INV)**). Un módulo solo usa la API pública de otro (**R-EST-02 (INV)**).
3. El dominio no hace entrada/salida ni importa frameworks (**R-DOM-01 (INV)**). Hora, azar e identificadores entran por parámetro o por puerto (**R-PAR-01 (INV)**).
4. La infraestructura implementa interfaces de dominio o aplicación (**R-INF-01 (INV)**). La aplicación solo la usa a través de ellas, inyectadas (**R-APL-03 (INV)**).
5. La presentación valida la forma (**R-PRE-01 (INV)**), traduce y no contiene negocio (**R-PRE-02 (INV)**; no se reimplementan ahí, **R-ERR-14**) ni importa infraestructura ni dominio, salvo tipos de solo lectura que la aplicación exponga (**R-PRE-04 (INV)**).
6. La aplicación orquesta el caso de uso y controla transacción (**R-APL-05 (INV)**) y autorización (**R-APL-06 (INV)**). La autenticación se resuelve en la presentación.
7. Nada cruza una frontera sin mapeo: ni entidades (**R-FLU-03 (INV)**) ni modelos de persistencia (**R-INF-02 (INV)**).
8. Las dependencias concretas se crean solo en la raíz de composición (**R-FLU-08 (INV)**).
9. El protocolo se queda en la presentación (**R-PRE-05 (INV)**). El dominio no lo conoce (**R-ERR-10 (INV)**).
10. Cada frontera traduce a un error propio del sistema, con tipo y código estables (**R-ERR-01 (INV)**), y conserva la causa (**R-ERR-03 (INV)**). Nada interno ni sensible llega al cliente (**R-ERR-12 (INV)**) ni a los logs (**R-ERR-04 (INV)**, **R-ERR-16 (INV)**). Un único punto en presentación traduce y registra (**R-ERR-08 (INV)**). La infraestructura traduce excepciones externas (**R-INF-03 (INV)**). Platform solo registra ese manejador.
11. El proyecto declara en `docs/ARCHITECTURE.md` una política única para los errores esperados y la trazabilidad (**R-ERR-05 (INV)**).
12. Shared no tiene negocio (**R-SHR-02 (INV)**) ni importa de otras capas (**R-SHR-01 (INV)**).

### Capas y dónde va cada cosa

| Capa | Responsabilidad | No contiene |
| --- | --- | --- |
| Presentación | Validar forma, mapear, invocar un caso de uso, traducir al protocolo | Negocio, datos, transacciones |
| Aplicación | Orquestar, transacción, autorización | Negocio, persistencia, protocolo |
| Dominio | Conceptos y reglas del negocio | Entrada/salida, frameworks, reloj, azar |
| Infraestructura | Implementar puertos | Negocio, orquestación |
| Shared | Piezas genéricas sin negocio | Negocio, entrada/salida, imports de otras capas |

Platform registra el manejador. La raíz de composición crea y conecta; no es una capa.

| Desde \ Hacia | Presentación | Aplicación | Dominio | Infraestructura | Shared | Platform |
| --- | --- | --- | --- | --- | --- | --- |
| Presentación | — | Sí | Tipos de lectura expuestos | No | Sí | Sí |
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

1. ¿Vivirá meses o lo mantendrá más de una persona? Si no, no uses capas formales.
2. ¿El núcleo son reglas sobre entidades? Si no, esta skill no aplica.
3. ¿Reglas no triviales o más de una integración externa? Sí → completa. No → ligera.
4. ¿Varios subdominios con poco en común? Sí → módulos y, dentro, capas, sobre la estructura existente.

Ligera: presentación, servicios (aplicación + dominio) e infraestructura; repositorios opcionales; datos y funciones; transferencias solo en la frontera exterior. Completa: las cuatro capas; repositorios obligatorios; entidades y value objects; transferencias en todas las fronteras.

La ligera separa al menos presentación e infraestructura y aplica las reglas de errores INV (**R-GEN-05 (INV)**). En la completa, el dominio define las interfaces de repositorio de sus agregados, en términos de dominio (**R-DOM-05 (DEF)**). Un proyecto nuevo usa la variante invertida. Si usa la clásica, lo documenta en el mapa (**R-GEN-03 (DEF)**). Las consultas de solo lectura pueden devolver objetos de transferencia sin entidades; las escrituras no (**R-FLU-07 (DEF)**). Única excepción a **R-GEN-01**.

Señales de mal uso: reenvíos, un campo en seis archivos, entidades sin comportamiento, saltar capas, tocar todas las capas de todos los módulos.

### Frameworks

1. Identifica lo que impone (rutas, pantallas, migraciones, arranque).
2. Clasifícalo como capa exterior.
3. Dominio y aplicación no importan nada del framework.
4. Si fusiona capas, variante ligera y excepción en `docs/ARCHITECTURE.md`.

Casos: `references/frameworks.md`.

### Checklist final

- Archivo nuevo en capa y ruta del mapa (**R-EST-07**, **R-AGT-03**).
- Nada existente reorganizado sin petición (**R-EST-04**, **R-AGT-02**).
- Archivos que impone el framework, delgados (**R-EST-08**).
- Imports según la matriz; sin ciclos ni internos de otros módulos (**R-FLU-02**, **R-GEN-04**, **R-EST-02**, **R-DOM-01**, **R-PRE-04**, **R-SHR-01**).
- Una operación de presentación, un caso de uso; comando inmutable, éxito o error esperado (**R-PRE-03**, **R-APL-02**).
- Ni entidades ni persistencia salen de su capa; salida por lista blanca (**R-FLU-03**, **R-INF-02**, **R-FLU-12**).
- Transacción en la aplicación; dependencias solo en la raíz (**R-APL-05**, **R-FLU-08**).
- Orden: parámetros, lógica de menor a mayor coste, saneamiento (**R-FLU-10**, **R-FLU-11**).
- Errores con tipo y código; esperados según política; técnicos lanzados (**R-ERR-01**, **R-ERR-02**, **R-ERR-05**, **R-ERR-06**).
- Infraestructura traduce y conserva la causa; sin capturas vacías ni registros duplicados (**R-INF-03**, **R-ERR-03**, **R-ERR-08**, **R-ERR-09**).
- Error al cliente sin internos, con `requestId` (**R-ERR-12**, **R-ERR-15**).
- Dominio sin efectos; value objects, transferencias y comandos inmutables; entidades sin mutadores públicos (**R-PAR-01**, **R-PAR-03**, **R-DOM-03**).
- Un único objeto de entrada donde es obligatorio (**R-PAR-09**).
- Pruebas de cada regla nueva y cada código de error esperado (**R-TST-01**, **R-TST-04**).
- Sin librerías que el proyecto ya cubría (**R-AGT-04**).

## 5. Manejo de Errores y Excepciones

- Sin `docs/ARCHITECTURE.md`, parte de la plantilla. Intensidad o framework sin decidir: hueco.
- Si el proyecto ya tiene mapa, no lo sobrescribas.
- Framework que fusiona capas: variante ligera y excepción en `docs/ARCHITECTURE.md`.
- `check-boundaries.sh` sale con 0 OK, 1 violaciones, 2 no comprobado.
- Un DEBERÍA desviado se registra en `docs/ARCHITECTURE.md`.
