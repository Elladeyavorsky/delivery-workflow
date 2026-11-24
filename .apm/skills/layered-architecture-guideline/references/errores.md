# Errores

Se lee para la taxonomía, la jerarquía `AppError`, la política de los errores esperados y el manejador global.

La política única y la trazabilidad se declaran en `docs/ARCHITECTURE.md` (R-ERR-05). El error que cruza una frontera es un error propio del sistema, con tipo y código estables (R-ERR-01).

## Taxonomía

| `kind` | Esperado | Origen | HTTP | Log |
| --- | --- | --- | --- | --- |
| `validation` | Sí | Presentación | 400 | `debug` |
| `unauthorized` | Sí | Presentación | 401 | `info` |
| `forbidden` | Sí | Aplicación | 403 | `warn` |
| `not_found` | Sí | Aplicación | 404 | `info` |
| `conflict` | Sí | Aplicación o infraestructura | 409 | `info` |
| `domain_rule` | Sí | Dominio | 422 | `info` |
| `infrastructure` | No | Infraestructura | 503 | `error` |
| `unexpected` | No | Cualquiera | 500 | `error` |

HTTP solo si la presentación es HTTP. Formato: Problem Details (RFC 9457) con `code`, `requestId` y, en `validation`, `errors: [{ path, code, message }]`.

Recomendación para los errores esperados: `Result`. Si el lenguaje o el equipo prefieren excepciones tipadas, la jerarquía sigue siendo `AppError` y la decisión se escribe en «Excepciones y decisiones» de `docs/ARCHITECTURE.md`.

## Qué hace cada capa

| Capa | Produce | Captura | Traduce |
| --- | --- | --- | --- |
| Dominio | `DomainError` | Nada | Nada |
| Aplicación | `NotFoundError`, `ForbiddenError`, `ConflictError`; propaga el dominio | Solo las excepciones de su contrato | Nada |
| Infraestructura | `InfrastructureError`, `ConflictError` (lanzados) | Excepciones de librería | Librería → `AppError` con `cause` (R-INF-03) |
| Presentación | `ValidationError`, `UnauthorizedError` | Todo, en el manejador global | `AppError` → protocolo; el resto → `UnexpectedError` (R-ERR-08) |

La lógica de traducción vive en presentación. Platform solo registra el manejador en el servidor. Si el framework ofrece un enganche global, se registra ahí.

## Trazabilidad y reglas

Reutiliza el `requestId` si llega en una cabecera; si no, genéralo. Propágalo en logs y en llamadas salientes. Logs JSON: `timestamp`, `level`, `requestId`, `kind`, `code`, `module`.

- **R-ERR-02 (CONV)** Los `code` DEBEN ser estables, estar escritos en SCREAMING_SNAKE_CASE, llevar el prefijo del módulo (`ORDER_`, `USER_`) y estar definidos en un catálogo por módulo. Cambiar un código publicado es un cambio incompatible.
- **R-ERR-06 (CONV)** Los errores de tipo `infrastructure` y `unexpected` DEBEN propagarse como excepciones, con cualquier política.
- **R-ERR-07 (CONV)** NO DEBE devolverse `null`, `undefined`, `-1` ni `false` para indicar un error. `null` solo significa ausencia legítima (por ejemplo, `findById` sin resultado), y la capa que lo recibe decide si eso es un `not_found`.
- **R-ERR-09 (CONV)** NO DEBE haber bloques `catch` vacíos ni bloques que lo capturen todo sin traducir ni relanzar.
- **R-ERR-11 (CONV)** Los textos que ve el usuario final DEBEN resolverse en presentación a partir del `code`, mediante un catálogo de mensajes o i18n. NO DEBEN depender del texto de `message`.
- **R-ERR-15 (DEF)** Todo error registrado DEBE incluir el `requestId`, y el mismo identificador DEBE devolverse al cliente.

## Plantillas

Adáptalas al lenguaje del proyecto. Subclases: `ValidationError`, `NotFoundError`, `DomainError`, `InfrastructureError`, `UnexpectedError`.

```typescript
// [shared] AppError y Result
export abstract class AppError extends Error {
  abstract readonly kind: ErrorKind;
  constructor(readonly code: string, message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    options?: { cause?: unknown }) {
    super(message, options); this.name = new.target.name;
  }
}
export type Result<T, E = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

```typescript
// [infraestructura] traduce y conserva cause (R-INF-03)
try { return row ? OrderMapper.toDomain(row) : null; }
catch (e) {
  throw new InfrastructureError("DB_READ_FAILED", "No se pudo leer", { orderId: id }, { cause: e });
}
```

```typescript
// [presentación] traduce y registra (R-ERR-08); platform solo lo registra
const e = error instanceof AppError ? error : new UnexpectedError(error);
logger[e.kind === "unexpected" ? "error" : "info"]("request_failed", { requestId: req.id, kind: e.kind, code: e.code });
return { status, body: { code: e.code, requestId: req.id } };
```
