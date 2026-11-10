---
name: create-draft
description: "Pasa a draft una pull request que ya existe. La usa create-pr al actualizarla, no para crearla ni para pedir revisión."
---

### Herramienta: CREATE_DRAFT

- **Descripción**: Pasa una pull request a draft.
- **MCP**: El servidor MCP `github`, declarado en `apm.yml`.

#### Especificación de Argumentos

1. **Pull request** : El número o la URL de la pull request de la rama actual.

#### Reglas de Invocación Críticas

- **Procesamiento de respuestas**: Confirma el estado draft. Si ya está en draft, conserva ese estado. Si no existe, comunica el error.
