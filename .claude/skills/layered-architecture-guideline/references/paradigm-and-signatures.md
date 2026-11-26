# Paradigma y firmas

Se lee para el núcleo funcional, las firmas, RORO y el modelo de dominio.

Núcleo funcional, cáscara imperativa: reglas, cálculos, validaciones y *mappers* son funciones puras. Coordinación y efectos son objetos o fábricas con dependencias inyectadas. El dominio está libre de efectos secundarios (R-PAR-01): hora, identificadores y azar llegan por parámetro o por puerto (`Clock`, `IdGenerator`).

Son efectos secundarios: E/S, leer el reloj, generar valores aleatorios o identificadores, estado global mutable y leer variables de entorno.

Presentación: controladores inyectados, esquemas, efectos de protocolo. Aplicación: caso de uso con dependencias, `Result`, efectos solo por puertos. Dominio: entidades, value objects y errores, sin efectos. Infraestructura: adaptadores y *mappers*. Shared: `Result`, utilidades puras.

Equivalencias: dato inmutable = `Readonly<T>` / `@dataclass(frozen=True)` / `record` / `data class` con `val` / `struct`. Puerto = `interface` / `Protocol`. `Result` = unión discriminada / `sealed class` / `(T, error)` / `{:ok, v} | {:error, e}`. Sin clases: el caso de uso es una fábrica que recibe dependencias y devuelve `execute`.

## Inmutabilidad, entidades y configuración

- **R-FLU-04 (CONV)** **R-PAR-03 (CONV)** Los comandos, las consultas, los DTO, los value objects y los eventos DEBEN ser inmutables y contener solo datos, sin comportamiento. Una operación sobre ellos devuelve una instancia nueva.
- **R-APL-02 (CONV)** Un caso de uso DEBE recibir un único objeto de entrada inmutable (comando o consulta) y devolver un DTO o un `Result` con un DTO. El objeto de entrada sigue RORO (R-PAR-09).
- **R-DOM-02 (DEF)** Las invariantes de una entidad DEBEN protegerse dentro de la propia entidad: no puede existir una instancia en estado inválido. Aplica a la variante completa.
- **R-DOM-03 (CONV)** Las entidades NO DEBEN exponer *setters* públicos. El estado cambia solo mediante métodos con nombre de negocio (`confirm()`, `addLine()`).
- **R-DOM-04 (CONV)** Los conceptos con reglas propias (dinero, email, cantidad, rango de fechas) DEBERÍAN modelarse como value objects en lugar de como primitivos.
- **R-SHR-04 (DEF)** La configuración DEBE leerse y validarse una sola vez, al arrancar, y entregarse a cada componente como un objeto tipado. Las capas interiores NO DEBEN leer variables de entorno directamente.

## Paradigmas

- **R-PAR-02 (CONV)** Los cálculos, las reglas sin estado, las validaciones y los mapeos DEBEN implementarse como funciones puras.
- **R-PAR-04 (CONV)** Las entidades PUEDEN tener estado mutable, pero ese estado solo DEBE cambiar a través de métodos que comprueben sus invariantes. Sus colecciones internas NO DEBEN exponerse de forma mutable.
- **R-PAR-05 (CONV)** Los componentes con dependencias (controladores, casos de uso, repositorios, clientes) DEBEN recibirlas desde fuera: por constructor si son objetos, o como argumento de una función fábrica si son funciones. NO DEBEN usar *singletons* globales ni localizadores de servicios.
- **R-PAR-06 (CONV)** La herencia DEBERÍA limitarse a la jerarquía de errores y a lo que exija el framework. Para reutilizar comportamiento se prefieren la composición o las funciones.
- **R-PAR-07 (DEF)** El estado compartido mutable (cachés, *pools*, contadores) solo PUEDE existir en infraestructura o en platform, y DEBE ser seguro ante la concurrencia.
- **R-PAR-08 (CONV)** Un proyecto DEBE elegir un estilo único para construir los casos de uso (clases o funciones fábrica) y aplicarlo en todos los módulos. El estilo se registra en `docs/ARCHITECTURE.md`.

## RORO

RORO (*Receive an Object, Return an Object*): un objeto de entrada con parámetros nombrados y, si hay varios valores de salida, un objeto con nombre. `Result<DTO>` ya es un objeto.

- **R-PAR-09 (CONV)** Los casos de uso, los métodos de puertos con más de un parámetro y las fábricas de entidades y value objects con más de dos campos DEBEN seguir RORO: un único objeto de entrada, tipado e inmutable.
- **R-PAR-10 (CONV)** Cualquier otra función DEBERÍA seguir RORO cuando tenga tres o más parámetros, algún parámetro booleano, parámetros opcionales o dos o más parámetros del mismo tipo.
- **R-PAR-11 (CONV)** RORO NO DEBERÍA usarse en funciones puras de uno o dos parámetros con significado evidente, en *callbacks* de `map` / `filter` / `reduce` ni en código de rendimiento crítico.
- **R-PAR-12 (CONV)** El objeto de entrada DEBE tener un tipo con nombre que distinga los campos obligatorios de los opcionales, y los valores por defecto DEBEN declararse en un único sitio (la firma o el esquema).
- **R-PAR-13 (CONV)** Una función DEBERÍA devolver un objeto con nombre cuando produce más de un valor o cuando es previsible que su salida crezca. Si devuelve un único valor de significado evidente, PUEDE devolver un primitivo.

## Plantilla de entidad (notación TypeScript)

```typescript
// [dominio] invariantes dentro, sin setters, sin E/S
export class Order {
  private constructor(readonly id: OrderId, private _lines: readonly OrderLine[], private _status: OrderStatus) {}
  static draft({ id }: { id: OrderId }): Order { return new Order(id, [], "draft"); }
  addLine(line: OrderLine): Result<void, DomainError> {
    if (this._status !== "draft") return err(OrderErrors.notEditable(this.id));
    this._lines = [...this._lines, line];
    return ok(undefined);
  }
}
```
