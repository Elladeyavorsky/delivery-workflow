# Flujo y validación

Se lee para la secuencia de una operación, las fronteras, la validación y la resiliencia.

Ningún objeto cruza una frontera sin mapeo (R-FLU-03, R-INF-02). Las entidades no salen de aplicación; la presentación recibe DTO.

## Secuencia y fronteras

Exterior → presentación (carga sin tipar) → valida forma → `execute`(comando) → unidad de trabajo y autorización (R-APL-05, R-APL-06) → repo vía interfaz → dominio → efectos externos → `save` → DTO por lista blanca → protocolo.

Fases: (1) parámetros en presentación, sin E/S; (2) lógica en aplicación y dominio (memoria → almacenamiento propio → servicios externos → escrituras); (3) saneamiento por lista blanca.

Fronteras: exterior→presentación, carga / DTO de petición; presentación→aplicación, comando / `Result<DTO, DomainError>`; aplicación↔dominio, entidades; aplicación↔infraestructura, tipos de dominio; presentación→exterior, DTO o `DomainError` / protocolo. El *mapper* vive en la capa exterior.

## Reglas

- **R-FLU-05 (DEF)** Cada *mapper* DEBE vivir en la capa exterior de la frontera que traduce y DEBE ser una función pura.
- **R-FLU-06 (DEF)** Si un caso de uso devuelve un error esperado, la unidad de trabajo DEBE descartar los cambios. Si lanza una excepción, DEBE revertirlos.
- **R-FLU-09 (DEF)** El dominio DEBE limitarse a registrar eventos. La publicación DEBE hacerla la aplicación, a través de un puerto, después de confirmar la transacción. Si la entrega tiene que estar garantizada, la infraestructura DEBERÍA usar el patrón *outbox*.
- **R-FLU-10 (CONV)** Toda operación DEBE ejecutar sus comprobaciones en tres fases y en este orden: (1) validar los parámetros, (2) validar la lógica, (3) sanear la respuesta. Una fase NO DEBE empezar si la anterior ha fallado.
- **R-FLU-11 (CONV)** Dentro de la validación de la lógica, las comprobaciones DEBERÍAN ordenarse de menor a mayor coste: en memoria, almacenamiento propio, servicios externos y, al final, escrituras. Si ese orden revelara información a quien no tiene permiso, la autorización DEBE ir primero.
- **R-FLU-12 (CONV)** La respuesta DEBE construirse por lista blanca: el DTO de salida enumera explícitamente cada campo. NO DEBE serializarse una entidad, un modelo de persistencia ni un objeto completo.
- **R-FLU-13 (DEF)** El escapado o la codificación de la salida (HTML, CSV, *shell*) DEBE hacerse en presentación, según el destino, y no al guardar los datos.
- **R-FLU-14 (CONV)** La entrada NO DEBE corregirse en silencio para hacerla válida: se valida y, si no cumple, se rechaza. Solo PUEDEN aplicarse las normalizaciones declaradas en el esquema, como recortar espacios o pasar un email a minúsculas.
- **R-PRE-03 (DEF)** Cada operación de presentación (endpoint, comando, acción de pantalla) DEBERÍA invocar exactamente un caso de uso.
- **R-GEN-06 (DEF)** Dentro de una capa, una unidad (caso de uso, controlador, servicio, repositorio, cliente) NO DEBE llamar a otra unidad de la misma capa. Si dos necesitan lo mismo, se extrae una función general a shared (a platform si es técnica y la capa puede usarla) y ambas la usan; si es negocio, lo coordina la capa superior. Quedan fuera las piezas del modelo de dominio entre sí (una entidad usa sus value objects) y los métodos privados de la misma unidad.
- **R-APL-04 (DEF)** Un caso de uso NO DEBERÍA llamar a otro caso de uso. La lógica compartida se extrae a un servicio de dominio o, si es genérica, a shared. Caso particular de R-GEN-06.
- **R-ERR-14 (DEF)** Las reglas de negocio NO DEBEN reimplementarse en presentación. Si la interfaz las repite para dar una respuesta inmediata al usuario, el dominio sigue siendo la fuente de verdad y siempre vuelve a comprobarlas. Véase R-PRE-02.

Las consultas de solo lectura (R-FLU-07) se resuelven con un *query service*: interfaz en aplicación, implementación en infraestructura, DTO directo, sin entidades. Las escrituras no usan este atajo.

## Resiliencia

- **R-INF-04 (DEF)** Los reintentos, los *timeouts*, los *circuit breakers* y la caché DEBEN implementarse en infraestructura, de forma transparente para el resto.

## Plantillas

TypeScript es notación. `HttpRequest`, `Database`, `schema` y `validate` son marcadores: sustitúyelos y adapta la sintaxis al proyecto.

```typescript
// [aplicación] comando → Result<DTO>
export class AddOrderLine {
  constructor(private readonly orders: OrderRepository, private readonly uow: UnitOfWork) {}
  execute(cmd: AddOrderLineCommand): Promise<Result<OrderSummary>> {
    return this.uow.run(async () => {
      const order = await this.orders.findById(OrderId(cmd.orderId));
      if (!order) return err(domainError("order", "missing"));
      const added = order.addLine({ productId: ProductId(cmd.productId), quantity: cmd.quantity });
      if (!added.ok) return added;
      await this.orders.save(order);
      return ok(toOrderSummary(order));
    });
  }
}
```

```typescript
// [presentación] valida forma e invoca un caso de uso
const parsed = validate(AddLineRequestSchema, req.body);
if (!parsed.ok) throw new ValidationError(parsed.error);
const result = await this.addOrderLine.execute({ orderId: req.params.orderId, ...parsed.value });
// política Result: el error de dominio sube; cómo se traduce al protocolo lo decide el proyecto
if (!result.ok) throw result.error;
return { status: 200, body: presentOrderSummary(result.value) };
```
