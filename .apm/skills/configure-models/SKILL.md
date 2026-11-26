---
name: configure-models
description: "Elige el modelo de IA de cada agente del paquete según la suscripción de la persona y lo escribe en los archivos de los agentes. Úsala tras apm install o apm update, o cuando la persona quiera cambiar el modelo de un agente."
---

### Herramienta: CONFIGURE_MODELS

- **Descripción**: Úsala para elegir, con la persona, el modelo de cada agente (`concept-developer`, `code-developer`, …). Sin esta configuración los agentes usan el modelo del chat y nada falla. Funciona con opencode, Cursor, Claude Code y Codex. En opencode, además, quita el campo `skills:` de los agentes del paquete.
- **Comando de Terminal**: `node "<carpeta de esta skill>/scripts/configure-models.mjs" ORDEN [OPCIONES]`, desde la raíz del repositorio git.

La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/configure-models`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

#### Especificación de Argumentos

1. **Orden** _(Obligatorio)_:
   - `detect`: lee los modelos y devuelve, por herramienta, la propuesta de cada agente (modelo, nivel, motivo y si viene de lo guardado). No escribe nada.
   - `apply`: escribe el modelo en cada agente y guarda la elección. Sin `--set` usa lo guardado o, si no hay nada, la propuesta.
   - `reset`: quita el modelo de todos los agentes y borra lo guardado.
2. **`--set agente=modelo`** _(Opcional, repetible)_: el modelo de ese agente. `inherit` quita el modelo (el agente usa el del chat). Exige `--target` si hay más de una herramienta: cada herramienta nombra sus modelos a su manera.
3. **`--yes` / `-y`** _(Opcional)_: acepta la propuesta sin preguntar.
4. **`--target opencode|cursor|claude|codex`** _(Opcional)_: una sola herramienta. Por defecto, todas las que tengan carpeta de agentes.
5. **`--models id1,id2,...`** _(Opcional)_: la lista de modelos de la herramienta, para cuando el script no puede leerla (por ejemplo, `cursor-agent` no está instalado). Sustituye a la detección y el script propone por nivel igual que si la hubiera leído. Exige `--target` si hay más de una herramienta. Úsala en `detect` y repítela en `apply`. En opencode los ids van como `proveedor/modelo`.
6. **`--provider nombre`** _(Opcional, solo opencode)_: el proveedor del que salen las propuestas. Se guarda con las elecciones, también cuando ningún agente lleva modelo. Un proveedor que no está en la lista es un error que nombra los disponibles.

#### opencode

- **Modelos**: salen de `opencode models`, lanzado en la raíz del proyecto, como `proveedor/modelo`. Si `opencode` no está en el PATH, en macOS se usa el comando que trae la app de escritorio (`OpenCode.app`).
- **Varios proveedores**: la salida trae `providers` y, mientras no haya uno elegido, las propuestas van vacías. Pregunta a la persona cuál usa y repite `detect` y `apply` con `--provider`. La lista incluye los modelos gratuitos del proveedor `opencode` aunque no tenga credenciales, así que no elijas por ella.
- **`skills:`**: `apply` lo quita de los 9 agentes del paquete en `.opencode/agents/`, haya o no modelos que escribir. opencode no precarga esas skills y envía el campo al proveedor del modelo en las peticiones `openai-compatible`; cada agente carga las skills que su texto nombra. Tras `apply`, `check-status` dice «configurado» aunque ningún agente lleve modelo. `apm install` y `apm update` reponen el campo: hay que repetir `apply`, y `check-status` lo avisa. `reset` no lo repone.

#### Reglas de Invocación Críticas

- **Tú hablas, el script no**: El script nunca pregunta. Las preguntas las haces tú y le pasas la respuesta con `--set`.
- **Con `--yes`**: Lanza `detect` y después `apply --yes` sin `--set`, sin preguntar nada. Muestra la tabla final. Si opencode tiene varios proveedores y ninguno guardado, sus agentes heredan el modelo del chat: dilo con las `notes`.
- **Sin `--yes`**:
  1. Lanza `detect`. Si falla porque no hay carpeta de agentes, dile a la persona que ejecute `apm install`. Si opencode trae varios `providers` y `provider` es `null`, pregunta cuál usa y repite `detect` con `--provider`.
  2. Muestra una tabla por herramienta con las columnas agente, modelo (`heredar` si es `null`) y motivo. Debajo, las `notes`. Si la detección es `unknown`, di el motivo, que ningún agente tiene modelo propuesto y que la persona puede escribir uno a mano.
  3. Pregunta **una vez**: «¿Los aceptas? [Enter = sí | nombre del agente para cambiarlo]». Si hay `saved`, di que son los modelos guardados.
  4. Si responde con el nombre de un agente, pregunta su modelo. Enséñale los de la lista detectada y acepta cualquier otro escrito a mano; Enter = `inherit`. Repite la pregunta hasta que acepte.
  5. Lanza `apply` con un `--set` por cada cambio. Si hay varias herramientas, un `apply --target T` por cada una, con solo sus cambios, y las que no cambian con un `apply` sin `--set`. Muestra la tabla final con lo que devuelve el script.
- **Si la detección es `unknown`** (por ejemplo, falta `cursor-agent`): no dejes todos los agentes en «heredar» ni calcules la propuesta a mano. Si tu propia sesión conoce los modelos que admite la herramienta para subagentes, pásalos con `--target T --models id1,id2,...` en `detect` y repite la misma lista en `apply`; la propuesta y las `notes` salen igual que con una lista leída. Usa solo ids que tu sesión liste de verdad; si no tienes una lista fiable, pídesela a la persona o déjalos heredar. Los modelos salen de una lista real.
- **Un modelo escrito a mano**: Avisa de que si la herramienta no lo reconoce, Cursor usará el modelo del chat sin decir nada, y Claude Code y opencode darán un error al llamar al agente. El script ya añade este aviso en `notes` si el modelo no está en la lista.
- **Después de `apm install` o `apm update`**: Instalar borra las líneas `model`. Si ya hay elecciones guardadas, `apply` sin argumentos las vuelve a poner sin preguntar nada. Dilo así a la persona.
- **Procesamiento de respuestas**: El script escribe JSON. `result` vale `cambiado`, `igual` o `ausente` (falta el archivo: pide `apm install`). Si el código de salida no es 0, lee el error y comunícalo. Usa solo los modelos y resultados que devuelve el script.
