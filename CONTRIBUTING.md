# Cómo contribuir a delivery-workflow

Esta guía lleva un cambio desde la issue hasta la pull request. La leen agentes y personas. Quien revisa solo lee la issue y la pull request: lo que necesite saber tiene que quedar escrito ahí.

Quien tiene permiso de escritura en el repositorio sube su rama a `origin`. Las personas ajenas al repositorio contribuyen desde un fork y no pueden subir ramas, asignar ni etiquetar: [Contribuir desde un fork](#contribuir-desde-un-fork) explica ese flujo.

## Contexto

delivery-workflow es un paquete [APM](https://github.com/microsoft/apm) para Claude Code, Cursor y Codex. Lleva una tarea de GitHub desde la idea hasta la revisión. El repositorio tiene:

- `.apm/skills/` y `.apm/agents/`: las skills y los agentes del paquete.
- `.github/`: los workflows (release, comprobaciones de código y de pull request, avisos de PR en Discord, actualización de la dependencia APM) y sus scripts.
- `tests/`: los tests del paquete.
- `docs/`: mantenimiento, modelos, avisos de Discord e investigación.

Antes de tocar nada, lee:

1. [README.md](README.md): qué hace el paquete, cómo se instala y cómo se usa.
2. [GLOSSARY.md](GLOSSARY.md): el vocabulario del flujo.
3. La issue del cambio: qué cambia y por qué.

## Requisitos

- Permiso de escritura en el repositorio o, si no lo tienes, un fork clonado con tu fork como remoto `origin`.
- `git`, [GitHub CLI](https://cli.github.com) (`gh`), Node 20 o superior y APM. Para los tests de Python, [uv](https://docs.astral.sh/uv/).
- Un `.env` en la raíz con tu token de GitHub ([El token de GitHub](README.md#el-token-de-github)). `.env` está en `.gitignore`.
- El paquete instalado con APM para tu herramienta, como explica [Trabajar en este repositorio](README.md#trabajar-en-este-repositorio).

## Reglas

### Las que comprueba el CI

`PR: check rules` y `Code: check` corren en las pull requests hacia `staging` que no están en draft. Si una regla falla, la pull request no pasa. La fuente de `PR: check rules` es [`review-pull-request.mjs`](.github/scripts/review-pull-request.mjs).

| Regla | Detalle |
| --- | --- |
| Base | La pull request va contra `staging`. `main` recibe cambios solo desde `staging`, en el release. |
| Rama | `número-tipo-descripcion`, por ejemplo `44-fix-setup-context7-subfolders`. |
| Título | Los de [Formatos](#formatos). |
| Cierre de la issue | El cuerpo tiene una línea propia `Closes #N`, sin más texto en esa línea. |
| Persona asignada | La pull request tiene una persona asignada. En una pull request desde un fork no se exige: [intenta asignar a Ventura](#contribuir-desde-un-fork) igualmente. |
| Commits | Cada commit de la pull request cumple el formato de [Formatos](#formatos). Un commit con `!` lleva `BREAKING CHANGE:` en el cuerpo. |
| `.env` | El diff no añade ni modifica ningún `.env`. |
| Versión | `version` en `apm.yml` no cambia: la versión sale de la etiqueta que crea el workflow de release. |
| Conflictos | La pull request no tiene conflictos con `staging`. |
| Tests | Pasan los tests de Node y de scripts que ejecuta [`code-check.yml`](.github/workflows/code-check.yml). |

### Las que no comprueba el CI

- Trabaja siempre a partir de una issue.
- No subas cambios a `main` ni a `staging`, ni siquiera de tu fork. Sube a tu rama de trabajo.
- No uses `git push --force` ni `--no-verify`.
- No commitees la línea `model` de los agentes: es personal ([Modelos de los agentes](README.md#modelos-de-los-agentes)).
- No edites a mano `apm_modules/` ni `apm.lock.yaml`: los genera `apm`.
- Un cambio de diseño del paquete pide una issue aprobada antes de empezar. Es diseño: el orquestador, dónde vive la spec, cómo se lee el token, cómo se eligen los modelos, y una skill o un agente nuevos.
- Di que algo funciona solo después de probarlo.

## Formatos

| Qué | Formato | Idioma |
| --- | --- | --- |
| Título de issue y de pull request | Empieza por un verbo con mayúscula (`Add`, `Fix`, `Document`). Menos de 72 caracteres, solo ASCII, sin punto final, sin tipo delante y sin número de issue. Ejemplo: `Fix the manifest search in setup-context7`. | Inglés |
| Cuerpo de issue y de pull request, y documentación | Con la skill [say-it-straight](.apm/skills/say-it-straight/SKILL.md). | Español |
| Rama | `número-tipo-descripcion`. La descripción lleva minúsculas, dígitos y guiones. | Inglés |
| Commit | `tipo: qué hace el cambio`, o `tipo(ámbito): …`. Imperativo, la descripción empieza en minúscula, solo ASCII y sin punto final. Un cambio que rompe algo que ya funcionaba lleva `!` tras el tipo y `BREAKING CHANGE:` en el cuerpo. | Inglés |
| Etiqueta de la issue | El tipo del cambio: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`. Sin permiso para etiquetar, déjala: quien mantiene la pone. | — |

Tipos de commit, con [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/):

| Tipo | Para qué |
| --- | --- |
| `feat` | Una funcionalidad nueva. |
| `fix` | La corrección de un error. |
| `docs` | Solo documentación. |
| `refactor` | Cambia el código sin cambiar lo que hace. |
| `test` | Tests nuevos o cambiados. |
| `chore` | Mantenimiento: configuración y tareas sin cambio visible. |
| `knowledge` | Conocimiento del proyecto que no es código ni documentación de uso. |

### Cómo afectan los commits a la versión

El workflow de release lee los commits al fusionar en `main` y una IA de Groq elige la versión:

- `major`: commits con `!` o `BREAKING CHANGE`, o un cambio completo de cómo se instala o se usa el paquete.
- `minor`: funcionalidades nuevas, normalmente commits `feat`.
- `patch`: `fix`, `docs`, `chore`, `refactor`, `test` y `knowledge`.

Usa el tipo que describe el cambio. No elijas uno para forzar una versión.

## Qué cambios se aceptan

- Correcciones de errores en skills, agentes, scripts y workflows.
- Mejoras de las skills y los agentes que ya existen.
- Documentación: erratas, explicaciones que faltan o que han quedado desfasadas.
- Tests nuevos o mejores.

Cualquier otro cambio necesita una issue aprobada antes de empezar. Eso incluye los cambios de diseño de la lista de reglas.

## Contribuir desde un fork

Esta sección es para quien no tiene permiso de escritura en el repositorio original. Un fork no da esos permisos, y eso cambia cinco pasos del flujo.

1. **Prepara el fork.** Clona tu fork como `origin`, añade el original como `upstream` y sincroniza `staging` antes de crear la rama:

   ```bash
   git remote add upstream https://github.com/venturars/delivery-workflow.git
   git fetch upstream
   git checkout staging && git merge --ff-only upstream/staging && git push origin staging
   ```

2. **Crea la issue en el repositorio original.** Busca antes en las [issues](https://github.com/venturars/delivery-workflow/issues) si ya existe una parecida. Sin permiso de triage no puedes poner la etiqueta ni asignar. No hace falta: quien mantiene pone la etiqueta.
3. **Escribe la spec, el plan y las tasks donde puedas.** `issue-spec can-edit N` dice si puedes editar el cuerpo de la issue. Con `yes`, escríbelos en el cuerpo. Con `no`, publícalos como comentario con `issue-spec revision N fichero` y usa `--revision` en `read`, `write`, `tick` y `state`. `/delivery-workflow` lo decide solo.
4. **Sube la rama a tu fork y abre la pull request contra el original:**

   ```bash
   git push -u origin 44-fix-setup-context7-subfolders
   gh pr create --repo venturars/delivery-workflow --base staging \
     --head TU_USUARIO:44-fix-setup-context7-subfolders --draft
   ```

5. **Asigna la pull request a Ventura (`venturars`).** Si GitHub no te deja asignarla, déjala sin asignar: `PR: check rules` no exige la asignación en una pull request desde un fork.

`/delivery-workflow` escribe la spec en un comentario cuando no puedes editar la issue. No está probado en un fork para etiquetar, asignar ni subir la rama: haz a mano el paso que falle, con los comandos de esta sección, y deja constancia en la pull request.

## Flujo de trabajo

Cada paso espera a que el anterior esté hecho. Puedes hacerlo a mano o pedirlo a `/delivery-workflow` (en Codex, `$delivery-workflow`), que sigue los mismos pasos.

1. **Localiza la issue** y entiende qué hay que resolver. Si no existe, créala con el formato de [Formatos](#formatos).
2. **Crea la rama** desde `staging` con el formato `número-tipo-descripcion`.
3. **Haz el commit vacío de apertura** `chore: open #N` y súbelo. La pull request necesita al menos un commit para abrirse.
4. **Abre la pull request contra `staging` en draft.** En el cuerpo, una línea `Closes #N`.
5. **Escribe la spec, el plan y las tasks en la issue**, bajo `## Spec`, `## Plan` y `## Tasks`.
6. **Desarrolla y prueba** con [las comprobaciones](#comprobaciones-antes-de-pedir-revisión). Guarda cada trozo en un commit y súbelo.
7. **Atiende la revisión.** Si piden cambios, súbelos a la misma rama.

Lo que pasa después no es cosa tuya: quien mantiene el paquete lleva `staging` a `main` y publica la versión ([Publicar una versión](docs/MAINTENANCE.md#publicar-una-versión)).

## Comprobaciones antes de pedir revisión

Los comandos están en [Tests del paquete](docs/MAINTENANCE.md#tests-del-paquete): ejecútalos desde la raíz del repositorio.

El CI ejecuta solo los tests de Node y de scripts. Los de Python y `apm-audit` corren solo en local.

Si cambias una skill o un agente, prueba el cambio también en un repositorio desechable, como explica [Probar el paquete](docs/MAINTENANCE.md#probar-el-paquete).

En la descripción de la pull request escribe qué comprobaciones ejecutaste y el resultado, y cuáles no pudiste ejecutar y por qué. Si una comprobación falla, arréglala antes de seguir.

## Cuándo parar y preguntar

- Falta un dato o dos documentos se contradicen: no decidas. Pregunta a la persona que te encargó el cambio y deja la pregunta en un comentario de la issue.
- El cambio no está en [Qué cambios se aceptan](#qué-cambios-se-aceptan): para hasta que la issue esté aprobada.
- Una regla del CI no se puede cumplir: dilo en la pull request y sigue con el resto.

## Si dudas de cómo escribir el código

No hay una guía de estilo aparte. Busca la respuesta en este orden y para en el primero que la dé:

1. La issue del cambio: la spec, el plan y las tasks.
2. [README.md](README.md): instalación, uso y permisos.
3. [GLOSSARY.md](GLOSSARY.md): el vocabulario del flujo.
4. [CHANGES.md](CHANGES.md): de dónde sale el paquete y qué cambia respecto al original.
5. [docs/MAINTENANCE.md](docs/MAINTENANCE.md): tests, prueba manual y release.
6. El código y los tests que ya existen en el mismo directorio: imita su estilo.

Si ninguno lo cubre, o dos se contradicen, sigue [Cuándo parar y preguntar](#cuándo-parar-y-preguntar).

## Licencia

delivery-workflow usa la licencia [Apache 2.0](LICENSE). Al contribuir, la aportación se publica con esa misma licencia, como dice su sección 5.

Si reutilizas el paquete, conserva el aviso de [NOTICE](NOTICE) y menciona el proyecto original.
