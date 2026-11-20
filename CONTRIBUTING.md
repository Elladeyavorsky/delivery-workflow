# Cómo contribuir a delivery-workflow

Esta guía lleva un cambio desde la issue hasta la pull request. Quien revisa solo lee la issue y la pull request, así que todo lo que necesite saber tiene que quedar escrito ahí.

## Contexto

delivery-workflow es un paquete [APM](https://github.com/microsoft/apm) para Claude Code, Cursor y Codex. Lleva una tarea de GitHub desde la idea hasta la revisión. El repositorio tiene:

- `.apm/skills/` y `.apm/agents/`: las skills y los agentes del paquete.
- `.github/`: los workflows de release y de avisos de PR en Discord.
- `tests/`: los tests del paquete.
- `docs/`: mantenimiento, modelos, avisos de Discord.

Antes de tocar nada, lee:

1. [README.md](README.md): qué hace el paquete, cómo se instala y cómo se usa.
2. [GLOSSARY.md](GLOSSARY.md): el vocabulario del flujo.
3. [AGENTS.md](AGENTS.md): formato de la issue en este repositorio (sección `## Decisión`).
4. La issue del cambio: qué se decide, por qué y qué alternativas se descartaron.

## Reglas del proyecto

Haz:

- Trabaja siempre a partir de una issue.
- Abre la pull request contra `staging`: `main` recibe cambios solo desde `staging`, en el release.
- Escribe los commits en inglés con [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/).
- Escribe issues, pull requests y documentación en español, con la skill [say-it-straight](.apm/skills/say-it-straight/SKILL.md).
- Pregunta en la issue cuando falte un dato o dos documentos se contradigan.

Para no romper nada:

- Un cambio de diseño del paquete (orquestador, dónde vive la spec, el token, los modelos, una skill o un agente nuevos) pide una issue aprobada antes. Esa issue deja escrita la decisión, el motivo y las alternativas descartadas.
- El `.env` y tu token de GitHub quedan fuera de los commits: dan acceso a tu cuenta.
- La línea `model` de los agentes también queda fuera de los commits: es personal ([Modelos de los agentes](README.md#modelos-de-los-agentes)).
- `apm_modules/` y `apm.lock.yaml` los genera `apm`: cámbialos a través de `apm`, no a mano.
- `version` en `apm.yml` cambia solo en el commit de release.
- `main` y `staging` cambian por pull request: sube tus cambios a tu rama de trabajo.
- Da por bueno un cambio cuando lo hayas probado.

## Qué cambios se aceptan

- Correcciones de errores en skills, agentes, scripts y workflows.
- Mejoras de las skills y los agentes que ya existen.
- Documentación: erratas, explicaciones que faltan o que han quedado desfasadas.
- Tests nuevos o mejores.

Cualquier otro cambio necesita una issue aprobada antes de empezar. Eso incluye una skill o un agente nuevos, y cambios en el orquestador, en dónde vive la spec, en cómo se lee el token o en cómo se eligen los modelos.

## Cómo se escribe la issue

Busca antes en las [issues](https://github.com/venturars/delivery-workflow/issues) si ya existe una parecida. Si no, crea una con este formato:

- **Título** en inglés, empezando por un verbo. Ejemplo: `Fix the manifest search in setup-context7`.
- **Etiqueta** con el tipo de cambio: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`.
- **Descripción** en español. Si usas `/delivery-workflow`, la skill `manage-issue` la escribe con la plantilla del tipo.
- **Decisión** en el cuerpo: qué se decide, por qué, y qué alternativas se descartaron. Quien revise la pull request solo lee la issue: el motivo del cambio tiene que estar ahí.

Si es un error, añade los pasos para reproducirlo, lo que esperabas y lo que ha pasado. Si lo has visto en la [prueba manual](docs/MAINTENANCE.md#probar-el-paquete), anota también la herramienta y el paso.

## Flujo de trabajo

Cada paso espera a que el anterior esté hecho. Puedes hacerlo a mano o pedirlo a `/delivery-workflow`, que sigue los mismos pasos.

1. **Localiza la issue** y entiende qué hay que resolver.
2. **Escribe la spec, el plan y las tasks en la issue**, bajo `## Spec`, `## Plan` y `## Tasks`.
3. **Crea la rama** desde `staging` con el formato `número-tipo-descripcion`. Ejemplo: `44-fix-setup-context7-subfolders`.
4. **Desarrolla** la tarea.
5. **Prueba** lo desarrollado con las comprobaciones de abajo.
6. **Haz los commits** con las convenciones de abajo.
7. **Abre una pull request contra `staging`.** En la descripción escribe `Closes #número` con el número de la issue.
8. **Atiende la revisión.** Si piden cambios, súbelos a la misma rama.

Lo que pasa después no es cosa tuya: quien mantiene el paquete lleva `staging` a `main` y publica la versión ([Publicar una versión](docs/MAINTENANCE.md#publicar-una-versión)).

## Comprobaciones antes de pedir revisión

Desde la raíz del repositorio:

```bash
node --test tests/*.mjs
node --test tests/discord-pr-notifications/*.test.mjs
bash tests/scripts.test.sh
uv run --no-project --python 3.15 --with pytest --with markdownify --with beautifulsoup4 python -m pytest -p no:cacheprovider tests/docs_rag
bash tests/apm-audit.test.sh
```

`bash tests/apm-audit.test.sh` crea una copia temporal del paquete, excluye el estado local y los artefactos generados, regenera allí los artefactos APM y ejecuta `apm audit --ci`. Al terminar, elimina la copia temporal y deja intacto el checkout.

Si cambias una skill o un agente, prueba el cambio también en un repositorio desechable, como explica [Probar el paquete](docs/MAINTENANCE.md#probar-el-paquete).

Si una comprobación falla, arréglala antes de seguir. Si no puedes ejecutarla, dilo en la pull request. Di que algo funciona solo después de probarlo.

## Convenciones de commits

Un commit tiene este formato:

```text
tipo: qué hace el cambio
```

| Tipo | Para qué |
| --- | --- |
| `feat` | Una funcionalidad nueva. |
| `fix` | La corrección de un error. |
| `docs` | Solo documentación. |
| `refactor` | Cambia el código sin cambiar lo que hace. |
| `test` | Tests nuevos o cambiados. |
| `chore` | Mantenimiento: configuración, versión y tareas sin cambio visible. |
| `knowledge` | Conocimiento del proyecto que no es código ni documentación de uso. |

El mensaje va en inglés, en imperativo y sin punto final. Un cambio que rompe algo que ya funcionaba lleva `!` tras el tipo (`feat!:`) y `BREAKING CHANGE:` en el cuerpo.

Los commits no deciden la versión. La decide `version` en `apm.yml`.

## Cómo se escribe el código

Sigue los documentos del repositorio. Mandan sobre cualquier otra costumbre:

- [README.md](README.md): instalación, uso y permisos.
- [GLOSSARY.md](GLOSSARY.md): vocabulario del flujo.
- [CHANGES.md](CHANGES.md): de dónde sale el paquete y qué cambia respecto al original.
- [docs/MAINTENANCE.md](docs/MAINTENANCE.md): tests, prueba manual y release.
- La issue del cambio: la decisión, el motivo y las alternativas descartadas.

Si dos documentos se contradicen, o ninguno cubre tu caso, pregunta en la issue antes de decidir.

## Licencia

delivery-workflow usa la licencia [Apache 2.0](LICENSE). Al contribuir, la aportación se publica con esa misma licencia, como dice su sección 5.

Si reutilizas el paquete, conserva el aviso de [NOTICE](NOTICE) y menciona el proyecto original.
