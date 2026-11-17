# Las buenas prácticas de Docker son una skill general

La skill `docker-best-practices` reúne las reglas para el Docker de desarrollo de un proyecto. El agente la usa al crear, cambiar o revisar un `Dockerfile`, un `docker-compose.yml` o un `devcontainer.json`, o al decidir qué se ejecuta en Docker. No forma parte del ciclo de entrega: el orquestador no la llama.

Sale de la instalación con Docker de aTempo (venturars/aTempo#74) y de su revisión. Cada regla responde a algo que pasó allí: una imagen base sin versión exacta, un `apt-get` sin versión fija, Python instalado solo para una herramienta que tenía binario, `node_modules` de Linux en la carpeta del proyecto, un Dev Container que Docker Compose 5 no construía y una ventana de Electron que no tenía pantalla.

## Qué trae

- `SKILL.md`: la decisión de para qué es Docker, las reglas y las comprobaciones antes de la pull request.
- `references/`: versiones fijas, Compose y volúmenes, Dev Container y apps gráficas en contenedores, con ejemplos.
- `assets/`: plantillas de `Dockerfile` y `docker-compose.yml` con valores por rellenar.
- `scripts/check-docker.sh`: revisa un `Dockerfile` y avisa de una imagen sin versión exacta, de paquetes de `apt-get`, npm o pip sin versión, de `apt-get` sin `--snapshot`, de descargas sin `sha256sum`, de una imagen que termina con root y de un `.dockerignore` que falta.

## Opciones consideradas

- **Una skill solo para aTempo:** Sus reglas sirven para cualquier proyecto. Los casos de aTempo quedan como ejemplos.
- **Una skill personal de quien la escribió:** No llegaría al resto del equipo ni a otros proyectos que instalan el paquete.
- **Un linter externo (hadolint):** Cubre parte de las reglas, pero no las de Compose, volúmenes o snapshot de Debian, y añade una herramienta que instalar. El script cubre lo que el paquete pide y no necesita nada más que bash.

## Consecuencias

- Hay veintidós skills en `.apm/skills/`. La nueva lleva script y tests.
- El script avisa, no corrige: cada aviso se arregla o se explica en la pull request.
- Las versiones y huellas de los ejemplos son de la fecha en que se escribieron. La skill pide comprobar cada una en su fuente, no copiarlas.
