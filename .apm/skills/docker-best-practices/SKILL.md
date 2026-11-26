---
name: docker-best-practices
description: "Buenas prácticas para Dockerfile, docker-compose.yml y devcontainer.json: decidir para qué es Docker, fijar versiones, instalar lo mínimo, separar node_modules por proyecto y comprobar antes de la PR. Úsala al crear, cambiar o revisar esos ficheros, o al decidir qué se ejecuta en Docker. Fuera de alcance: Kubernetes."
---

# Skill: Docker best practices

## 1. Perfil y Rol

- **Rol:** Reglas para el Docker de un proyecto: construir, instalar, ejecutar y comprobar con las mismas versiones para todo el equipo.
- **Objetivo Principal:** Una imagen reproducible, que cualquiera construye igual hoy y dentro de un mes, y que no rompe la carpeta del proyecto en ningún sistema.
- **Tono de Comunicación:** Neutro, directo, en español.

## 2. Contexto y Alcance

- **Cuándo actuar:** Al crear, cambiar o revisar un `Dockerfile`, un `docker-compose.yml`, un `.dockerignore` o un `.devcontainer/devcontainer.json`, y al decidir qué parte del trabajo va en Docker.
- **Fuera de alcance:** Kubernetes.
- **Límites de conocimiento:** Cada versión, nombre de paquete y checksum sale de su fuente (la imagen, el índice de paquetes, la release), comprobado en el momento.

La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/docker-best-practices`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

## 3. Flujo de Trabajo (Paso a Paso)

1. **Decide para qué es Docker** (sección 4) y escríbelo en la documentación de arquitectura del proyecto antes de escribir el `Dockerfile`.
2. **Escribe o cambia los ficheros** siguiendo las reglas de la sección 5. Las plantillas están en `<carpeta de esta skill>/assets/`.
3. **Revisa el `Dockerfile`** con `bash "<carpeta de esta skill>/scripts/check-docker.sh" [RUTA_AL_DOCKERFILE]`, desde la raíz del repositorio. Sin ruta, revisa `./Dockerfile`. Sale con 0 si no encuentra nada, con 1 si encuentra algo (cada línea dice qué y dónde) y con 2 si falta el fichero. Corrige cada aviso o explica en la PR por qué se queda.
4. **Comprueba de verdad** con los pasos de la sección 6 antes de abrir la pull request.

## 4. Primero: para qué es Docker

Elige una opción y escribe el porqué:

- **Instalador:** Docker instala dependencias y herramientas con versiones fijas, y los programas se usan en el ordenador. Encaja cuando el equipo trabaja con apps de escritorio (editores o agentes como opencode, Cursor o Codex) que leen la carpeta del ordenador y lanzan allí sus comandos.
- **Donde se ejecutan cosas:** servidores de desarrollo, comprobaciones, bases de datos. Cada uno, un servicio.
- **Entorno completo (Dev Container):** todo el trabajo dentro del contenedor. Solo si las herramientas del equipo lo abren bien.

Una app gráfica (Electron, un navegador) no tiene pantalla dentro de un contenedor. Si hace falta, es opcional y experimental: ver `<carpeta de esta skill>/references/gui-en-contenedores.md`.

## 5. Reglas

### Versiones fijas

| Qué | Cómo |
|---|---|
| Imagen base | Etiqueta exacta (`node:24.22.3-trixie`), mejor con `@sha256:` |
| Herramientas de npm, pip o similar | Versión exacta (`pnpm@10.33.0`) |
| Binarios descargados | Versión y SHA-256 escrito por arquitectura, comprobado con `sha256sum -c` |
| Paquetes de `apt-get` | `paquete=versión` y `--snapshot FECHA` de snapshot.debian.org |

- Saca las versiones del propio proyecto (`packageManager`, `.nvmrc`, `engines`) para que Docker y CI no se separen.
- Para actualizar, cambia versión y checksum, o versión y fecha, en el mismo commit.
- Detalle y ejemplos: `<carpeta de esta skill>/references/versiones-fijas.md`.

### Instalar lo mínimo

- Antes de instalar un intérprete para una herramienta, busca su binario oficial. Comprueba su glibc con `ldd --version` en la base.
- Lista solo los paquetes de primer nivel: `apt` instala sus dependencias. Comprueba con `ldd` que no falta ninguna librería.
- `--no-install-recommends`, y `update`, `install` y `rm -rf /var/lib/apt/lists/*` en un mismo `RUN`.
- Si la imagen completa ya trae lo que hace falta (git, curl), úsala en vez de una `slim` donde habría que instalarlo sin versión.

### Estructura de la imagen

- Multi-stage para lo opcional (`base` y, por ejemplo, `gui`). Nombra el `target` en Compose y en `devcontainer.json`: sin él, Docker construye la última etapa.
- Usuario sin privilegios (`USER node` o el que traiga la base). Antes, `chown` de las carpetas donde se montarán volúmenes.
- `.dockerignore` que excluye todo (`*`) si la imagen no copia nada porque el proyecto llega montado.
- `ARG TARGETARCH` para descargas distintas en arm64 y amd64, con error para cualquier otra.
- `git config --system --add safe.directory '*'` si git trabaja sobre un repositorio montado.
- `ENV CI=true` para que ninguna herramienta espere una respuesta.

### Caché de capas

- Ordena de lo que menos cambia a lo que más: base, paquetes del sistema, herramientas, dependencias y, al final, el código.
- Cada `ARG`, justo antes del `RUN` que lo usa: todos los `RUN` posteriores lo reciben, y cambiar su valor invalida la caché desde el primero.
- Si la imagen copia el proyecto: primero el manifiesto y el lockfile, después la instalación y al final el resto del código.
- `apt-get update` va en el mismo `RUN` que su `install`: solo, su capa quedaría en caché con una lista vieja.
- Lo que se descarga y se borra, en el mismo `RUN`: borrarlo en otra capa no reduce la imagen.
- `RUN --mount=type=cache` para las descargas del gestor de paquetes, y `cache-from` y `cache-to` en CI.
- Detalle: `<carpeta de esta skill>/references/cache-de-capas.md`.

### docker-compose.yml

- El proyecto, montado. Los `node_modules` (o `.venv`, `vendor`…), en volúmenes con nombre: los binarios de Linux rompen la app en macOS y Windows.
- Un volumen de dependencias por proyecto o lockfile. Solo se comparte la caché del gestor de paquetes.
- Cada servicio monta solo los volúmenes que usa.
- `profiles:` para servicios opcionales o experimentales: `docker compose up` sin nombre no los arranca.
- Deja que Compose ponga el nombre de la carpeta delante de los volúmenes: cada copia del repositorio tiene los suyos.
- `--build` en los flujos automáticos, para reconstruir la imagen si cambió el `Dockerfile`.
- Detalle: `<carpeta de esta skill>/references/compose-y-volumenes.md`.

### Dev Container

- El mismo `Dockerfile`, con `"target"`, construido directamente: con `dockerComposeFile`, Docker Compose 5 rechaza el Dockerfile que genera la herramienta.
- Volúmenes propios y la instalación en `postCreateCommand`.
- Detalle: `<carpeta de esta skill>/references/devcontainer.md`.

### Automatización con hooks de git

- Un hook siempre deja terminar a git: sale con 0 y avisa si Docker no está en marcha.
- Solo trabaja si cambiaron los ficheros que importan (lockfiles, manifiestos, `Dockerfile`) entre el commit de antes y el de después.
- Carpeta versionada con `core.hooksPath`, y el comando de una sola vez en el README.

### Documentación

- README: qué necesita cada ordenador, el comando de una sola vez y el uso diario.
- Documentación de arquitectura: por qué Docker hace lo que hace y no otra cosa.
- Comentarios en el `Dockerfile` solo para lo que no se ve: por qué esa base y cómo se actualizan las versiones fijas.

## 6. Comprobar antes de la pull request

1. Construir sin caché (`--no-cache`), y una vez con un checksum erróneo, que tiene que fallar. Después, construir dos veces seguidas: la segunda tiene que reutilizar todas las capas (`CACHED`).
2. Construir para la otra arquitectura (`--platform linux/amd64` o `linux/arm64`).
3. Lanzar los flujos de verdad: instalación, servidor o app, y las comprobaciones del proyecto.
4. `git status` limpio después, y la carpeta de dependencias vacía en el ordenador.
5. Un clon nuevo, siguiendo solo el README.
6. `docker compose config` para ver servicios, volúmenes y `target` tal como los aplicará Compose.

Si un paso no se puede hacer (otro sistema operativo, otra arquitectura), dilo en la PR como no probado.
