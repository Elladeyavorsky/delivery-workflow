# Dev Container

Un Dev Container abre el proyecto entero dentro de la imagen. Funciona con VS Code y con terminales donde corre un agente de línea de comandos. No todas las apps de escritorio lo abren: compruébalo con las herramientas del equipo antes de convertirlo en la forma principal de trabajar.

## Reutilizar el mismo Dockerfile

```jsonc
{
  "name": "proyecto",
  // Construye el Dockerfile directamente: con docker-compose.yml, Docker Compose 5
  // rechaza el Dockerfile que genera la herramienta de Dev Containers.
  "build": {
    "dockerfile": "../Dockerfile",
    "context": "..",
    "target": "base"
  },
  "workspaceMount": "source=${localWorkspaceFolder},target=/work,type=bind",
  "workspaceFolder": "/work",
  "mounts": [
    "source=${localWorkspaceFolderBasename}-devcontainer-node-modules,target=/work/app/node_modules,type=volume"
  ],
  "postCreateCommand": "bash docker/setup.sh",
  "forwardPorts": [6006]
}
```

- **`target`:** con varias etapas, sin él se construye la última.
- **Sin `dockerComposeFile`:** con Docker Compose 5, la construcción falla con `additional privileges requested: pass "--allow=fs.read=…"`. Ni `COMPOSE_BAKE=false` ni construir antes la imagen lo evitan. Construir el `Dockerfile` directamente sí.
- **Volúmenes propios:** con el nombre de la carpeta delante, para no pisar los de Compose ni los de otra copia del repositorio.
- **`postCreateCommand`:** el mismo script de instalación que el servicio de Compose, para que quede instalado igual.

## Probarlo sin editor

```sh
npx -y @devcontainers/cli up --workspace-folder .
npx -y @devcontainers/cli exec --workspace-folder . bash -c 'herramienta --version'
```

`up` tiene que terminar con `"outcome":"success"`. Después, borra el contenedor de prueba.
