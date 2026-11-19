# Caché de capas

Cada instrucción del `Dockerfile` es una capa. Al construir, Docker reutiliza todas las capas hasta la primera que cambió, y reconstruye esa y todas las siguientes. Una imagen bien ordenada se reconstruye en segundos; una mal ordenada lo reinstala todo por un cambio pequeño.

## De lo que menos cambia a lo que más

```dockerfile
FROM node:24.22.3-trixie AS base          # casi nunca
RUN apt-get update && apt-get install …   # pocas veces
RUN npm install --global "pnpm@10.33.0"   # al cambiar de versión
COPY package.json pnpm-lock.yaml ./       # al cambiar dependencias
RUN pnpm install --frozen-lockfile
COPY . .                                  # en cada cambio de código
```

## Cada ARG, justo antes del RUN que lo usa

Todos los `RUN` que vienen después de un `ARG` lo reciben como variable de entorno. Si su valor cambia, la caché se pierde **desde el primer `RUN` después del `ARG`**, aunque ese `RUN` no lo use.

```dockerfile
# Mal: cambiar APM_VERSION reconstruye también la capa de pnpm
ARG PNPM_VERSION=10.33.0
ARG APM_VERSION=0.35.0
RUN npm install --global "pnpm@${PNPM_VERSION}"
RUN … apm …

# Bien: cada uno cerca de su RUN
ARG PNPM_VERSION=10.33.0
RUN npm install --global "pnpm@${PNPM_VERSION}"
ARG APM_VERSION=0.35.0
RUN … apm …
```

`TARGETARCH` y los demás `ARG` que pone Docker siguen la misma regla.

## apt-get update e install en el mismo RUN

```dockerfile
# Mal: la capa de update queda en caché con la lista de paquetes de ese día
RUN apt-get update
RUN apt-get install -y paquete=versión

# Bien
RUN apt-get update && apt-get install -y --no-install-recommends paquete=versión \
  && rm -rf /var/lib/apt/lists/*
```

Separados, un cambio en la línea de `install` reutiliza la lista vieja de `update`: la instalación falla o trae versiones antiguas. Con `--snapshot` la lista no cambia, pero la regla sigue valiendo para quien no lo use.

## Si la imagen copia el proyecto

Copia primero lo que define las dependencias (manifiesto y lockfile), instala, y después copia el resto. Así un cambio en el código no reinstala las dependencias.

Si el proyecto llega montado como volumen (imagen de desarrollo que no copia nada), esta regla no aplica: las dependencias se instalan al ejecutar, en volúmenes, y la caché es la del gestor de paquetes.

## Lo que se borra, en la misma capa

Borrar en una capa posterior no reduce la imagen: el fichero sigue en la capa donde se creó. Descarga, usa y borra en el mismo `RUN` (`rm /tmp/tool.tar.gz`, `rm -rf /var/lib/apt/lists/*`).

## Caché de descargas sin meterla en la imagen

BuildKit permite montar una caché solo durante un `RUN`. Las descargas sobreviven entre construcciones y no acaban en la imagen:

```dockerfile
RUN --mount=type=cache,target=/root/.cache/pnpm,sharing=locked \
    pnpm install --frozen-lockfile

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update && apt-get install -y --no-install-recommends paquete=versión
```

Las imágenes de Debian traen `docker-clean`, que vacía la caché de apt después de cada instalación: hay que quitarlo para que la caché montada sirva. Con caché montada, no hace falta `rm -rf /var/lib/apt/lists/*`: esa carpeta no queda en la imagen.

## Caché en CI

En GitHub Actions, cada ejecución empieza sin caché. Con `docker/build-push-action`, guárdala en la caché de Actions:

```yaml
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v6
  with:
    context: .
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

## Comprobar que la caché funciona

1. Construye dos veces seguidas: la segunda tiene que marcar `CACHED` en todos los pasos.
2. Cambia solo el código, o solo una versión fija, y construye: solo se reconstruyen las capas de después.
3. Construye con `--no-cache` antes de la pull request, para comprobar que la imagen también se construye desde cero.
