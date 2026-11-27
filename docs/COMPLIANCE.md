# Documentación de compliance

`/setup-compliance` genera en `docs/` del proyecto la base de los documentos que piden el AI Act y el RGPD. Se lanza a mano tras `apm install`; la instalación no la ejecuta.

## Documentos que genera

| Documento | Qué trae | Cuándo lo propone |
|---|---|---|
| `docs/ai-act.md` | Clasificación del sistema según el Reglamento (UE) 2024/1689: prohibido, alto riesgo, riesgo limitado o riesgo mínimo, con el motivo y los artículos | Siempre |
| `docs/dpia.md` | Evaluación de impacto del RGPD 35.7: tratamiento y fines, necesidad y proporcionalidad, riesgos y medidas | Siempre |
| `docs/security.md` | Threat model: activos, actores, amenazas (incluidas inyección de instrucciones, fuga de datos por las respuestas y envenenamiento de datos) y una mitigación por amenaza | Siempre |
| `docs/system-card.md` | Ficha del sistema, para quien lo opera | Siempre |
| `docs/model-card.md` | Ficha del modelo, para quien lo usa | Con ficheros de pesos o una dependencia de entrenamiento |
| `docs/data-card.md` | Ficha de los datos, para quien los audita | Con ficheros de pesos, una dependencia de entrenamiento o ficheros de datos de entrenamiento |

## Qué lee la skill

La skill lee el proyecto sin escribir nada:

- Las dependencias de IA de `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod` y `Cargo.toml`. La lista de dependencias que cuentan está en `assets/ai-signals.json` de la skill.
- Los ficheros de pesos de modelo: `.safetensors`, `.onnx`, `.pt`, `.pth`, `.gguf`, `.h5`, `.joblib` y `.pkl`.
- La sección `## Datos personales` de `docs/CONSTITUTION.md`.

Después te entrevista en tandas, con una respuesta recomendada por pregunta, y confirma una vez qué documentos genera; puedes quitar o añadir fichas. Si `data-protection-guideline` está instalada, la DPIA usa sus ítems `DP-NN` para los riesgos y las medidas.

## Reglas de cada documento

- Cada afirmación cita su fuente: un fichero del proyecto, la sección de `docs/CONSTITUTION.md` o «entrevista (AAAA-MM-DD)».
- Lo que la skill no deduce ni obtiene en la entrevista queda como `> **Hueco:** <qué falta>`, para que lo rellenes.
- La última línea dice «Documento orientativo: no certifica cumplimiento ni es asesoramiento jurídico.». La skill no escribe un documento sin ella.

## Qué pasa al repetirla

Cada documento generado empieza por `<!-- setup-compliance sha256=… -->`, el hash del resto del fichero. Al repetir `/setup-compliance`, un documento sin editar se actualiza; uno que editaste, o que escribiste tú sin esa marca, se conserva tal cual.

Al terminar, la skill muestra una tabla con cada documento, su ruta, el resultado y el número de huecos:

| Resultado | Significado |
|---|---|
| `creado` | El documento no existía y la skill lo escribió. |
| `igual` | El documento ya decía lo mismo. |
| `actualizado` | El documento no estaba editado y la skill lo reescribió. |
| `conservado` | El documento está editado o no lleva la marca, y la skill no lo tocó. |

La skill no cambia `docs/CONSTITUTION.md` ni mantiene los documentos al día en cada tarea: repítela cuando el proyecto cambie.
