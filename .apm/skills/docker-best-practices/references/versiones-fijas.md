# Versiones fijas

Una imagen es reproducible si construirla hoy y dentro de un mes da lo mismo. Eso exige fijar cada capa.

## Imagen base

```dockerfile
# Mal: cambia con cada versión nueva de Node 24 y de Debian
FROM node:24-bookworm

# Bien: versión exacta
FROM node:24.22.3-trixie

# Mejor: versión exacta y digest, que no cambia aunque alguien vuelva a publicar la etiqueta
FROM node:24.22.3-trixie@sha256:<digest>
```

Las imágenes de sistema (Debian, Ubuntu) no llevan `X.Y.Z`: su etiqueta exacta lleva la fecha (`debian:trixie-20261104-slim`), o se fija con el digest. `debian:13` o `ubuntu:24.04` cambian con cada actualización.

El digest sale de `docker buildx imagetools inspect node:24.22.3-trixie`. Comprueba que la etiqueta existe con `docker manifest inspect IMAGEN:ETIQUETA` antes de escribirla.

Si el proyecto ya fija la versión del runtime (`.nvmrc`, `engines`, `.python-version`), usa la misma.

## Herramientas de npm, pip o similar

```dockerfile
ARG PNPM_VERSION=10.33.0
RUN npm install --global "pnpm@${PNPM_VERSION}"
```

La versión sale del proyecto (`packageManager` en `package.json`) para que el contenedor y el ordenador usen la misma.

## Binarios descargados

Antes de instalar un intérprete solo para una herramienta, mira si su release publica un binario. Fija la versión y la huella de cada arquitectura:

```dockerfile
ARG TOOL_VERSION=0.35.0
ARG TOOL_SHA256_ARM64=<sha256 de tool-linux-arm64.tar.gz>
ARG TOOL_SHA256_X86_64=<sha256 de tool-linux-x86_64.tar.gz>
ARG TARGETARCH

RUN case "$TARGETARCH" in \
    arm64) arch=arm64; sha256=$TOOL_SHA256_ARM64 ;; \
    amd64) arch=x86_64; sha256=$TOOL_SHA256_X86_64 ;; \
    *) echo "Arquitectura sin binario: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && curl -fsSL -o /tmp/tool.tar.gz "https://example.org/releases/v${TOOL_VERSION}/tool-linux-${arch}.tar.gz" \
  && echo "${sha256}  /tmp/tool.tar.gz" | sha256sum -c - \
  && mkdir -p /opt/tool \
  && tar -xzf /tmp/tool.tar.gz -C /opt/tool --strip-components=1 \
  && rm /tmp/tool.tar.gz \
  && ln -s /opt/tool/tool /usr/local/bin/tool
```

- Las huellas salen de los ficheros `.sha256` de la release, no de descargar el binario y calcularla tú.
- Un binario empaquetado con su propio runtime (por ejemplo, PyInstaller) necesita una glibc mínima. Compruébalo arrancándolo en la base: `docker run --rm IMAGEN tool --version`. Si falla con `GLIBC_2.xx not found`, la base es demasiado antigua.
- Prueba una vez con una huella errónea: la construcción tiene que fallar.

## Paquetes de apt-get

Fijar solo `paquete=versión` tiene un problema: los servidores normales de Debian guardan solo la última versión de cada paquete. Cuando sale una actualización de seguridad, la versión fijada desaparece y la construcción falla.

La solución es fijar también la fecha con snapshot.debian.org, el archivo permanente de Debian. `apt` 2.8 o posterior (Debian 13) lo admite con `--snapshot`:

```dockerfile
ARG DEBIAN_SNAPSHOT=20261116T000000Z
USER root
RUN apt-get update --snapshot "$DEBIAN_SNAPSHOT" \
  && apt-get install -y --no-install-recommends --snapshot "$DEBIAN_SNAPSHOT" \
    libgtk-3-0t64=3.24.49-3 \
    libnss3=2:3.110-1+deb13u5 \
  && rm -rf /var/lib/apt/lists/*
USER node
```

- La fecha fija también las dependencias que no se listan.
- Las versiones salen de la base con esa fecha: `apt-cache policy PAQUETE` dentro de un contenedor de la imagen, después de `apt-get update --snapshot FECHA`.
- Debian 13 renombró muchas librerías con el sufijo `t64` (`libgtk-3-0` → `libgtk-3-0t64`). Una guía escrita para Debian 12 trae los nombres viejos.
- Para actualizar, cambia la fecha y las versiones en el mismo commit.

## Qué no fijar

- Los paquetes que ya trae la imagen base: los fija la base.
- Las dependencias de los paquetes que listas: las fija la fecha del snapshot.
