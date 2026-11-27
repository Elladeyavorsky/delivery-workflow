# Docker

La skill `docker-best-practices` reúne las reglas para el Docker de un proyecto: decidir para qué es Docker, fijar cada versión (imagen, herramientas, binarios con su checksum y paquetes de `apt-get` con fecha de snapshot), separar las dependencias de cada proyecto en volúmenes, y comprobar antes de la pull request.

El agente la usa al crear, cambiar o revisar un `Dockerfile`, un `docker-compose.yml` o un `devcontainer.json`. También puedes pedirla tú: «Revisa el Dockerfile con docker-best-practices».

Trae plantillas de `Dockerfile` y `docker-compose.yml`, y un script que revisa un `Dockerfile` y avisa de lo que no tiene versión fija:

```bash
bash <carpeta de skills>/docker-best-practices/scripts/check-docker.sh Dockerfile
```
