# docker-compose.yml y volúmenes

## El proyecto montado, las dependencias en volúmenes

```yaml
services:
  setup:
    build:
      context: .
      target: base
    image: proyecto-dev
    command: bash docker/setup.sh
    volumes:
      - .:/work                                          # el proyecto, el mismo del ordenador
      - app-node-modules:/work/app/node_modules          # dependencias de Linux, dentro de Docker
      - pnpm-store:/pnpm-store                           # caché de pnpm, compartida

volumes:
  app-node-modules:
  pnpm-store:
```

- El bind mount (`.:/work`) hace que lo que el contenedor escribe en el proyecto aparezca al momento en el ordenador.
- El volumen montado encima de `node_modules` deja los paquetes de Linux dentro de Docker. En el ordenador, esa carpeta queda vacía. Muchos paquetes traen binarios de cada sistema (Electron, SQLite, esbuild, Vite): los de Linux no sirven en macOS ni en Windows, y al revés.
- Lo mismo vale para `.venv` en Python, `vendor` en PHP o `target` en Rust.

## Un volumen de dependencias por proyecto

Si el repositorio tiene varios proyectos, cada uno con su manifiesto y su lockfile, cada uno tiene su volumen. Un `node_modules` es el resultado de instalar un lockfile concreto: compartido, cada `install` lo ajusta a su lockfile y rompe el otro proyecto.

Lo que sí se comparte es la caché del gestor de paquetes (`pnpm-store`, la caché de npm o de pip): guarda cada paquete una vez para todos.

Un único `node_modules` exige convertir el repositorio en un workspace con un solo lockfile. Es un cambio de estructura, no de Docker.

## Cada servicio monta solo lo que usa

Un bloque común (`x-base`) con todos los volúmenes hace que cada servicio los monte todos, y parece que se comparten. Deja en el bloque común solo `build` e `image`, y declara los `volumes` en cada servicio:

```yaml
x-base: &base
  build:
    context: .
    target: base
  image: proyecto-dev

services:
  setup:      # instala todo: monta todo
    <<: *base
    volumes: [".:/work", "app-node-modules:/work/app/node_modules", "docs-node-modules:/work/docs/node_modules", "pnpm-store:/pnpm-store"]
  docs:       # solo lo suyo
    <<: *base
    volumes: [".:/work", "docs-node-modules:/work/docs/node_modules", "pnpm-store:/pnpm-store"]
```

## Servicios opcionales con perfiles

```yaml
  gui:
    profiles: [gui]
```

`docker compose up` sin nombre no arranca los servicios con perfil. `docker compose up gui` sí.

## Nombres de volumen

Compose pone delante el nombre de la carpeta: en `proyecto/` el volumen se llama `proyecto_app-node-modules`. Así cada copia del repositorio tiene los suyos, aunque estén en ramas con dependencias distintas. No fijes el nombre con `name:` salvo que de verdad haya que compartirlo.

## Puertos

- `ports: ["6006:6006"]` sigue el formato `ordenador:contenedor`.
- Un servidor dentro del contenedor tiene que escuchar en `0.0.0.0`, no en `localhost`, o el navegador del ordenador no llega.
- Dos cosas no pueden usar el mismo puerto del ordenador a la vez: un servidor en Docker y otro en el ordenador chocan.

## Reconstruir cuando cambia el Dockerfile

Con una `image:` con nombre, `docker compose run` reutiliza la imagen que ya existe aunque el `Dockerfile` haya cambiado. En los flujos automáticos, usa `docker compose run --build`, que reconstruye solo si cambió algo.
