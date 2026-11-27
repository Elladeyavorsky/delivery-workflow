# Cómo contribuir a delivery-workflow

Esta guía lleva un cambio desde la issue hasta la pull request. La leen agentes y personas. Quien revisa solo lee la issue y la pull request: lo que necesite saber tiene que quedar escrito ahí.

## Antes de empezar

delivery-workflow es un paquete [APM](https://github.com/microsoft/apm) con skills y agentes que llevan una tarea desde la idea hasta la revisión en el forge del proyecto. Lee, en este orden:

1. [README.md](README.md): qué hace el paquete, cómo se instala y cómo se usa.
2. [GLOSSARY.md](GLOSSARY.md): el vocabulario del flujo.
3. La issue del cambio: qué cambia y por qué.

Necesitas `git`, [GitHub CLI](https://cli.github.com), Node, APM y un `.env` con tu token de GitHub. Para instalar el paquete en este repositorio, sigue [Trabajar en este repositorio](#trabajar-en-este-repositorio).

## Trabajar en este repositorio

Este repositorio es el paquete: su fuente son las skills y los agentes de `.apm/`. No instales aquí `venturars/delivery-workflow`, que es para [otro proyecto](README.md#instalar-el-paquete). Despliega la copia local para tener los agentes y las skills del flujo (`/delivery-workflow`, `/check-status`, `say-it-straight`…) mientras lo cambias.

1. Clona el repositorio y entra en su raíz.
2. Despliega el paquete local en tu herramienta (`opencode`, `claude`, `cursor`, `codex` o varias separadas por comas):

   ```bash
   apm install --target opencode
   ```

3. Crea el `.env` con tu token, como explica [El token de GitHub](README.md#el-token-de-github).
4. Abre tu herramienta en la raíz. En opencode, ejecuta antes `/configure-models` ([Modelos de los agentes](docs/MODELS.md)).
5. Llama al orquestador `delivery-workflow` ([cómo llamarlo](README.md#uso)) para abrir la issue, la rama y la pull request de tu cambio.

Lo que genera `apm install` es de tu máquina y no se sube: `apm_modules/`, `apm.lock.yaml`, los directorios de tu herramienta y, con opencode, `opencode.json`, que no está en `.gitignore`. No los edites a mano: cambia `.apm/` y vuelve a ejecutar `apm install --target …`.

## Reglas

- Trabaja siempre a partir de una issue.
- Abre la pull request contra `staging`. `main` recibe cambios solo desde `staging`, en el release.
- No uses `git push --force` ni `--no-verify`.
- No commitees el `.env`, tu token ni la línea `model` de los agentes: es personal ([Modelos de los agentes](docs/MODELS.md)).
- No edites a mano lo que genera `apm` (`apm_modules/`, `apm.lock.yaml`) ni cambies `version` en `apm.yml`: la versión sale de la etiqueta del release.
- Di que algo funciona solo después de probarlo.

La pull request pasa unas comprobaciones automáticas: base, rama, título, `Closes #N`, commits, `.env`, versión, autodependencia, conflictos y tests. En una PR a `staging`, `apm.yml` no lista este paquete en `dependencies.apm`. La fuente es [`review-pull-request.mjs`](.github/scripts/review-pull-request.mjs); si una falla, su mensaje dice qué falta. No corren mientras la pull request está en draft.

## Qué cambios se aceptan

- Correcciones de errores en skills, agentes, scripts y workflows.
- Mejoras de las skills y los agentes que ya existen.
- Documentación: erratas, explicaciones que faltan o que han quedado desfasadas.
- Tests nuevos o mejores.

Cualquier otro cambio, y todo cambio de diseño del paquete, necesita una issue aprobada antes de empezar. Es de diseño lo que cambia el orquestador, dónde vive la spec, cómo se lee el token o se eligen los modelos, y una skill o un agente nuevos.

## Formatos

| Qué | Formato | Idioma |
| --- | --- | --- |
| Título de issue y de pull request | Empieza por un verbo con mayúscula (`Add`, `Fix`). Menos de 72 caracteres, solo ASCII, sin punto final, sin tipo delante y sin número de issue. Ejemplo: `Fix the manifest search in setup-context7`. | Inglés |
| Cuerpo de issue y de pull request, y documentación | Con la skill [say-it-straight](.apm/skills/say-it-straight/SKILL.md). La pull request lleva una línea `Closes #N`. | Español |
| Rama | `número-tipo-descripcion`, en minúsculas y con guiones. Ejemplo: `44-fix-setup-context7-subfolders`. | Inglés |
| Commit | `tipo: qué hace el cambio`, en imperativo, con la descripción en minúscula y sin punto final. Si rompe algo que ya funcionaba, `tipo!:` y `BREAKING CHANGE:` en el cuerpo. | Inglés |

El tipo es el mismo en la etiqueta de la issue, la rama y el commit: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` o `knowledge`, con [Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/). Elige el que describe el cambio: el release lee los commits para decidir la versión.

## Flujo de trabajo

Puedes seguirlo a mano o pedirlo al orquestador `delivery-workflow` ([cómo llamarlo](README.md#uso)), que hace los mismos pasos.

1. Localiza la issue. Si no existe, créala con el formato de arriba.
2. Crea la rama desde `staging`.
3. Haz el commit vacío `chore: open #N` y súbelo: la pull request necesita un commit para abrirse.
4. Abre la pull request contra `staging` en draft, con `Closes #N` en el cuerpo.
5. Escribe la spec, el plan y las tasks en la issue, bajo `## Spec`, `## Plan` y `## Tasks`.
6. Desarrolla y prueba. Guarda cada trozo en un commit y súbelo.
7. Atiende la revisión en la misma rama.

Después, quien mantiene el paquete lleva `staging` a `main` y publica la versión ([Publicar una versión](docs/MAINTENANCE.md#publicar-una-versión)).

## Contribuir desde un fork

Si no tienes permiso de escritura en el repositorio, trabaja desde un fork. El flujo es el mismo, con estas diferencias:

- Clona tu fork, añade el repositorio original como `upstream` y sincroniza `staging` antes de crear la rama.
- Crea la issue en el repositorio original. No puedes etiquetarla ni asignarla: quien mantiene lo hace.
- Si no puedes editar el cuerpo de la issue, la spec, el plan y las tasks van en un comentario. `/delivery-workflow` lo decide solo; a mano, usa [`issue-spec`](.apm/skills/issue-spec/SKILL.md).
- Sube la rama a tu fork y abre la pull request contra el repositorio original, en draft.
- Intenta asignar la pull request a quien mantiene el repositorio. Si no puedes, déjala sin asignar: la comprobación no lo exige en un fork.

`/delivery-workflow` no está probado en un fork para etiquetar, asignar ni subir la rama. Haz a mano el paso que falle y deja constancia en la pull request.

## Comprobaciones antes de pedir revisión

Ejecuta los tests de [Tests del paquete](docs/MAINTENANCE.md#tests-del-paquete) desde la raíz del repositorio. Si cambias una skill o un agente, prueba también el cambio en un repositorio desechable, como explica [Probar el paquete](docs/MAINTENANCE.md#probar-el-paquete).

En la descripción de la pull request escribe qué comprobaciones ejecutaste y el resultado, y cuáles no pudiste ejecutar y por qué. Si una comprobación falla, arréglala antes de seguir.

## Cuándo parar y preguntar

- Falta un dato o dos documentos se contradicen: no decidas. Pregunta a la persona que te encargó el cambio y deja la pregunta en un comentario de la issue.
- El cambio no está en [Qué cambios se aceptan](#qué-cambios-se-aceptan): para hasta que la issue esté aprobada.
- Una regla no se puede cumplir: dilo en la pull request y sigue con el resto.

## Si dudas de cómo escribir el código

No hay una guía de estilo aparte. Busca la respuesta en este orden y para en el primero que la dé:

1. La issue del cambio: la spec, el plan y las tasks.
2. [README.md](README.md) y [GLOSSARY.md](GLOSSARY.md).
3. [CHANGES.md](CHANGES.md), [docs/MAINTENANCE.md](docs/MAINTENANCE.md) y [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
4. El código y los tests que ya existen en el mismo directorio: imita su estilo.

Si ninguno lo cubre, sigue [Cuándo parar y preguntar](#cuándo-parar-y-preguntar).

## Licencia

delivery-workflow usa la licencia [Apache 2.0](LICENSE). Al contribuir, la aportación se publica con esa misma licencia, como dice su sección 5.

Si reutilizas el paquete, conserva el aviso de [NOTICE](NOTICE) y menciona el proyecto original.
