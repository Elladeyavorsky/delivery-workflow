# El modelo de cada agente es personal y no se sube a git

Cada agente puede llevar un `model`, y `configure-models` lo escribe en los archivos que `apm install` despliega (`.cursor/agents/…`, `.claude/agents/…`, `.codex/agents/…`). El modelo depende de la suscripción de cada persona, así que esas líneas no llegan nunca al repositorio: los 8 archivos de agentes del paquete se regeneran en cada instalación y se ponen en el `.gitignore`, uno a uno, para que los agentes propios del equipo sigan subiéndose. Las elecciones se guardan en `.git/delivery-workflow-models.json`, que git no ve, y `apply` es idempotente, para repetirlo tras cada `apm install`.

Los archivos desplegados son resultado de una instalación: `apm install` los vuelve a escribir y, como se comprobó con `apm` 0.35.0, borra la línea `model` sin avisar. Un `apply` que se pueda repetir encaja con eso. `.gitignore` no afecta a los archivos que git ya sigue, así que `apply` lo detecta y escribe el `git rm --cached` para que lo ejecute la persona; nunca lo ejecuta él. Una skill (no el script) hace las preguntas, como en la decisión 0001.

## Opciones consideradas

- **Ajuste de equipo:** subir los modelos al repositorio, con un modelo por agente para todos. Se descartó: obliga a que todos tengan el mismo modelo, que es justo lo que no pasa, y un modelo que uno no tiene hace fallar al agente o lo manda en silencio al modelo del chat.
- **Subir las líneas y vivir con las diferencias:** cada persona edita y los cambios de `model` entran en los commits. Se descartó: ruido en cada pull request y conflictos continuos.
- **Un archivo de elecciones dentro del proyecto:** más fácil de ver, pero habría que ignorarlo y no se sincroniza con nada. Se prefirió `.git/`, como la caché de revisores.

## Consecuencias

- Tras `apm install` o `apm update` hay que volver a aplicar. `check-status` avisa con «desincronizado» y el orquestador lo dice una vez, sin parar. `apm audit` marca los agentes como editados: es lo esperado.
- Los proyectos que ya suben estos archivos tienen que ejecutar una vez `git rm --cached` sobre ellos.
- El catálogo de agentes (`agent-profiles.json`) tiene que listar exactamente los de `.apm/agents/`: un test falla si se añade un agente sin ficha, para que no se quede sin modelo ni sin entrada en `.gitignore`.
- El nombre del modelo tiene que ser el que da la herramienta. Si no lo reconoce, el agente corre con el modelo del chat sin avisar, así que la lista se lee de la herramienta y lo escrito a mano se avisa.
- Cada herramienta aporta un detector y su formato de archivo (`.md` o `.toml`); el catálogo, la escritura, el `.gitignore` y el aviso de archivos seguidos son comunes.
