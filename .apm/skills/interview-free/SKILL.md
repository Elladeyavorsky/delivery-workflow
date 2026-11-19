---
name: interview-free
description: "Entrevista en tandas de preguntas, con respuesta recomendada, para afilar una idea que no depende del repositorio. La llama help-me-to-think."
---

### Herramienta: INTERVIEW_FREE

- **Descripción**: Úsala cuando la idea no depende de este repositorio, o cuando `interview-with-repo` ya dejó decisiones que el repositorio no responde. En ese caso va después. Para crear la issue, la rama o la pull request, usa `manage-issue`, `manage-branch` o `manage-pr`. Esta skill no tiene script ni llama a GitHub.
- **Inspiración**: [grill-me](https://www.skills.sh/mattpocock/skills/grill-me), de Matt Pocock. Esta versión pregunta en tandas, cada pregunta con su respuesta recomendada. La original no hace falta instalarla.

#### Cómo entrevistar

1. Haz las preguntas que necesites en cada tanda, cada una con su respuesta recomendada. Espera las respuestas antes de la tanda siguiente.
2. Contesta sin abrir el código: esta skill no recorre el repositorio.
3. Devuelve qué hay que hacer y cómo se comprueba. El resumen único lo cierra `help-me-to-think`.
