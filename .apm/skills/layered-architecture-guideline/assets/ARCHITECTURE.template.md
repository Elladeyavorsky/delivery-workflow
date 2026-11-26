# Mapa de capas

Estas rutas son la única referencia válida para ubicar archivos. La plantilla se adapta al proyecto, nunca al revés.

Si el proyecto no tiene `docs/ARCHITECTURE.md`, copia este fichero y rellena cada `Por decidir`. Si ya lo tiene, añade las secciones que falten; no sustituyas el fichero ni cambies las rutas que ya hay.

## Mapa de capas

Si el proyecto tiene varias partes (por ejemplo backend y frontend), repite esta tabla y la sección "Verificación de fronteras" por cada parte, con la ruta de cada una y su propia herramienta.

| Rol | Ruta o glob | Notas |
| --- | --- | --- |
| Presentación | Por decidir | |
| Aplicación | Por decidir | |
| Dominio | Por decidir | |
| Infraestructura | Por decidir | |
| Shared | Por decidir | |
| Platform | Por decidir | |
| Raíz de composición | Por decidir | |
| Pruebas | Por decidir | |

## Módulos

- Cómo se reconoce un módulo: Por decidir
- API pública: Por decidir

## Framework

| Ruta impuesta | Rol | Restricción |
| --- | --- | --- |
| Por decidir | Por decidir | Por decidir |

## Intensidad y organización

Una línea por módulo, ligera o completa según «Intensidad y variante».
- Intensidad:
  - `<módulo>`: ligera | completa
- Organización: Por decidir (por módulo y capa, o solo por capa)
- Nombres de archivo: Por decidir
- Unidades por archivo: Por decidir

## Estilo de los casos de uso

Por decidir (clases o funciones fábrica). El estilo es único en todos los módulos (R-PAR-08).

## Errores de dominio

- Cómo se entregan (excepciones o valores de error): Por decidir
- Dónde vive el catálogo: Por decidir
- `kind` además de VALIDATION, NOT_FOUND y CONFLICT: Por decidir
- Qué se hace fuera del dominio (protocolo, logs, trazabilidad): Por decidir

Una sola forma en todos los módulos (R-ERR-05). Si no hay nada decidido, la natural del lenguaje.

## Verificación de fronteras

- Herramienta: Por decidir
- Comando: Por decidir

**R-EST-06 (DEF)** El proyecto DEBERÍA verificar en integración continua las reglas R-GEN-04, R-DOM-01, R-PRE-04, R-SHR-01 y R-EST-02 con una herramienta automática de análisis de dependencias del ecosistema del proyecto, configurada con contratos de capas y de importaciones prohibidas sobre las rutas del mapa.

La herramienta la elige el proyecto según su stack. El agente anota aquí cómo se instala y qué comando la ejecuta.

## Excepciones y decisiones

Cualquier salto de un INV o desviación de un DEBERÍA se registra aquí.

| Fecha | Regla | Decisión | Motivo |
| --- | --- | --- | --- |
| | | | |
