# Errores

Se lee para errores de dominio y mínimos de seguridad. Lo demás (protocolo, logs y errores técnicos) lo decide el proyecto en `docs/ARCHITECTURE.md`.

## Modelo

Un fallo de negocio es un error de dominio con estos campos:

| Campo | Qué es | Ejemplo |
| --- | --- | --- |
| `kind` | Categoría, de un conjunto cerrado | `VALIDATION` |
| `code` | Identificador estable `etiqueta.razón` | `session.end_at.order` |
| `message` | Texto del catálogo; puede cambiar | `session.end_at debe ser posterior a session.start_at` |
| `entity`, `field` | Opcionales, salen de la etiqueta | `session`, `end_at` |
| `cause` | Error original, si lo hay | — |

`kind` base: `VALIDATION` (un dato o una regla no se cumple), `NOT_FOUND` (no existe lo que se pide) y `CONFLICT` (choca con el estado actual: duplicado, tiene dependientes). El proyecto puede añadir otros en `docs/ARCHITECTURE.md`.

El catálogo vive en el dominio, uno por módulo si hay módulos. Tiene las etiquetas (`entidad` o `entidad.campo`), las razones (`missing`, `taken`, `order`…) con su `kind` y su plantilla de mensaje, y los mensajes propios de un `code` cuando la plantilla no basta. Etiquetas y razones son listas cerradas: no se inventan en el punto de fallo.

## Cómo se entregan

Una sola forma en todo el proyecto (R-ERR-05). Orden para decidirla:

1. Lo que digan `docs/ARCHITECTURE.md` o `docs/STYLE.md`.
2. Si no dicen nada, lo que ya hace el código.
3. Si no hay nada, el mecanismo natural del lenguaje: excepciones o valores de error, según lo habitual. Se anota en `docs/ARCHITECTURE.md` y, si el flujo es interactivo, se confirma.

Con varias partes se decide por parte, con el mismo catálogo de `kind` y `code`.

## Qué hace cada capa

| Capa | Qué hace |
| --- | --- |
| Dominio | Crea los errores con la fábrica. No los captura ni los traduce. |
| Aplicación | Usa los mismos códigos (`session.missing` si no encuentra nada). Deja subir el resto. |
| Infraestructura | Traduce los fallos del almacén con significado de negocio a los mismos códigos y conserva la causa. Sin mapeo: error técnico (R-INF-03). |
| Presentación | Decide qué hacer con cada error según `kind` y `code`; recibe su tipo desde la aplicación (R-PRE-04). La forma la define el proyecto. |

## Reglas

- **R-ERR-02 (CONV)** El `code` DEBE tener la forma `etiqueta.razón`, salir del catálogo y ser estable. El texto de `message` puede cambiar en el catálogo; cambiar un `code` publicado es un cambio incompatible.
- **R-ERR-07 (CONV)** NO DEBE devolverse `null`, `undefined`, `-1` ni `false` para indicar un error. `null` solo significa ausencia legítima (por ejemplo, `findById` sin resultado), y la capa que lo recibe decide si eso es un `NOT_FOUND`.
- **R-ERR-11 (CONV)** Las decisiones y los textos que ve el usuario final DEBEN basarse en `kind` y `code`, mediante un catálogo de mensajes o i18n. NO DEBEN depender del texto de `message`.
- **R-ERR-17 (DEF)** Un fallo de negocio DEBE crearse con la única fábrica del proyecto, que recibe etiqueta y razón y consulta el catálogo. NO DEBE escribirse el mensaje en el punto de fallo ni crearse un error ad hoc. Con excepciones PUEDE haber un atajo que construye y lanza, siempre a través de la fábrica.

Mínimos de seguridad, para toda la arquitectura (`SKILL.md`, invariante 11): R-ERR-03, R-ERR-04, R-ERR-09, R-ERR-12 y R-ERR-16.

## Plantillas

TypeScript es notación. `REASONS`, `domainError`, `fail` e `isUniqueViolation` son marcadores: sustitúyelos y adapta la sintaxis al proyecto.

```typescript
// [dominio] catálogo (extracto)
export type Kind = "VALIDATION" | "NOT_FOUND" | "CONFLICT";
export const REASONS = {
  missing: { kind: "NOT_FOUND", message: (l: string) => `${l} no existe` },
  taken: { kind: "CONFLICT", message: (l: string) => `${l} ya existe` },
  order: { kind: "VALIDATION", message: (l: string) => `${l} va fuera de orden` },
} as const;
export type Label = "session" | "session.end_at";
export type Reason = keyof typeof REASONS;
```

```typescript
// [dominio] el error y la única fábrica (R-ERR-17)
export class DomainError extends Error {
  constructor(readonly kind: Kind, readonly code: string, message: string,
    readonly entity?: string, readonly field?: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
export function domainError(label: Label, reason: Reason, cause?: unknown): DomainError {
  const [entity, field] = label.split(".");
  const spec = REASONS[reason];
  return new DomainError(spec.kind, `${label}.${reason}`, spec.message(label), entity, field, { cause });
}
// atajo para la política de excepciones
export const fail = (label: Label, reason: Reason, cause?: unknown): never => {
  throw domainError(label, reason, cause);
};
```

```typescript
// [dominio] punto de fallo
if (endAt <= startAt) fail("session.end_at", "order");

// [infraestructura] mismo vocabulario y causa conservada (R-INF-03, R-ERR-03)
try { await db.insert(row); }
catch (e) {
  if (isUniqueViolation(e)) throw domainError("session", "taken", e);
  throw e; // técnico: el proyecto decide su forma
}
```
