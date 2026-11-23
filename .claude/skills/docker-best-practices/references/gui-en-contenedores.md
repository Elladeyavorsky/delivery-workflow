# Apps gráficas en contenedores

Un contenedor no tiene pantalla. Abrir la ventana de una app gráfica (Electron, Chromium, una app de escritorio) desde Docker es posible, pero más lento que en el ordenador y distinto en cada sistema. Si se hace, que sea opcional y experimental, y que la forma recomendada siga siendo el ordenador.

## Qué hace falta

1. **Las librerías de escritorio**, en una etapa aparte del `Dockerfile` para no cargarlas en la imagen base. Para Electron en Debian 13 bastan cuatro paquetes de primer nivel; `apt` instala el resto:

   ```dockerfile
   FROM base AS gui
   ARG DEBIAN_SNAPSHOT=20261116T000000Z
   USER root
   RUN apt-get update --snapshot "$DEBIAN_SNAPSHOT" \
     && apt-get install -y --no-install-recommends --snapshot "$DEBIAN_SNAPSHOT" \
       libgtk-3-0t64=3.24.49-3 \
       libnss3=2:3.110-1+deb13u5 \
       libasound2t64=1.2.14-1+deb13u1 \
       libgbm1=25.0.7-2+deb13u1 \
     && rm -rf /var/lib/apt/lists/*
   USER node
   ```

   Comprueba que no falta nada con `ldd RUTA_AL_BINARIO | grep "not found"`. Sin esas librerías, Electron falla con `error while loading shared libraries: libnspr4.so`.

2. **Los flags de Chromium**: `--no-sandbox` (el sandbox no arranca en un contenedor) y `--disable-gpu` (no hay acceso a la GPU).

3. **Memoria compartida**: `shm_size: 1gb` en Compose. Con los 64 MB por defecto, la ventana sale en blanco o se cierra.

4. **La pantalla del ordenador**, por la variable `DISPLAY`:

   | Sistema | Servidor gráfico | Configuración |
   |---|---|---|
   | macOS | XQuartz | Instalarlo (`brew install --cask xquartz`, pide la contraseña), activar «Permitir conexiones de clientes de red», `xhost +localhost` cada vez que se abre, `DISPLAY=host.docker.internal:0` |
   | Linux | X11 | `xhost +local:docker`, montar `/tmp/.X11-unix` y `DISPLAY=$DISPLAY` |
   | Windows 11 con WSL2 | WSLg | Montar `/mnt/wslg/.X11-unix` en `/tmp/.X11-unix` y `DISPLAY=:0` |

## Servicio de ejemplo

```yaml
  gui:
    profiles: [gui]
    build:
      context: .
      target: gui
    image: proyecto-dev-gui
    working_dir: /work/app
    command: pnpm run start -- --no-sandbox --disable-gpu
    environment:
      DISPLAY: ${PROJECT_DISPLAY:-host.docker.internal:0}
    shm_size: 1gb
    volumes:
      - .:/work
      - app-node-modules:/work/app/node_modules
```

Los flags después de `--` llegan a Electron a través del script `start`.

## Cómo probarlo sin pantalla

Con Xvfb (una pantalla virtual) y una captura, se comprueba que la app arranca y pinta sin depender de XQuartz:

```sh
xvfb-run -a -s "-screen 0 1440x900x24" bash -c "
  ./node_modules/.bin/electron . --no-sandbox --disable-gpu &
  # espera a que pinte
  import -window root /tmp/captura.png"
```

Xvfb e ImageMagick van solo en un contenedor de prueba, no en la imagen del proyecto.

## Al terminar en macOS

`xhost -localhost` vuelve a cerrar la pantalla. Mientras XQuartz admite clientes de red, escucha en el puerto 6000 de todas las interfaces.
