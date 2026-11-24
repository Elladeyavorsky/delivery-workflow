# Mapa de capas

Estas rutas son la única referencia válida para ubicar archivos. La plantilla se adapta al proyecto, nunca al revés.

Copia este fichero a `docs/ARCHITECTURE.md` y rellena cada `Por decidir`.

## Mapa de capas

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

- Intensidad: Por decidir (ligera o completa)
- Organización: Por decidir (por módulo y capa, o solo por capa)
- Nombres de archivo: Por decidir
- Unidades por archivo: Por decidir

## Estilo de los casos de uso

Por decidir (clases o funciones fábrica). El estilo es único en todos los módulos (R-PAR-08).

## Política de errores y trazabilidad

- Errores esperados: Por decidir
- Dónde se traduce y se registra: Por decidir
- Cómo se propaga el `requestId`: Por decidir

La política es única en todos los módulos (R-ERR-05).

## Verificación de fronteras

- Herramienta: Por decidir
- Comando: Por decidir

**R-EST-06 (DEF)** El proyecto DEBERÍA verificar en integración continua las reglas R-GEN-04, R-DOM-01, R-PRE-04, R-SHR-01 y R-EST-02 con una herramienta automática de análisis de dependencias del ecosistema del proyecto, configurada con contratos de capas y de importaciones prohibidas sobre las rutas del mapa.

```json boundaries
{
  "layers": {
    "presentation": [],
    "application": [],
    "domain": [],
    "infrastructure": [],
    "shared": [],
    "platform": []
  },
  "domainAllowedPackages": [],
  "modules": { "pattern": "", "publicApi": "" }
}
```

`layers` lleva expresiones regulares sobre la ruta relativa a la raíz del proyecto; `domainAllowedPackages` lista los paquetes que el dominio puede importar (por defecto ninguno); `modules` es opcional: `pattern` captura el nombre del módulo en el primer grupo y `publicApi` reconoce lo que el módulo expone. Si una capa obligatoria (presentación, aplicación, dominio, infraestructura) tiene el array vacío, la verificación sale con 2.

## Excepciones y decisiones

Cualquier salto de un INV o desviación de un DEBERÍA se registra aquí.

| Fecha | Regla | Decisión | Motivo |
| --- | --- | --- | --- |
| | | | |
