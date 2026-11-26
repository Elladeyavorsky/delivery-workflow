---
name: link-pr-to-issue
description: "Deja Closes #N en el cuerpo de la pull request y la enlaza con la issue en Development. Úsala desde el orquestador delivery-workflow después de manage-pr."
---

### Herramienta: LINK_PR_TO_ISSUE

- **Descripción**: Úsala desde el orquestador, después de `manage-pr`, para dejar `Closes #N` en el cuerpo y enlazar la issue en Development. `manage-pr` no la llama: puede abrir la pull request sin issue. Para abrir la pull request o cambiar su base, usa `manage-pr`. La línea `Closes #N` de la plantilla es la que cierra la issue al fusionar; esta skill no la cierra a mano.
- **Forge**: Antes de llamar, `node "<carpeta de esta skill>/scripts/gitlab.mjs" forge` escribe `github` o `gitlab`. Con `github`, usa los comandos de esta skill con `gh.sh`. Con `gitlab`, los de «En GitLab».
- **GitHub**: `bash "<carpeta de esta skill>/scripts/gh.sh" ARGUMENTOS`, desde la raíz del repositorio git. Lanza `gh` con el `GITHUB_TOKEN` del `.env` del proyecto. Usa siempre este script: así la acción queda a nombre de la cuenta del token.
- **Abreviatura**: Abajo, `gh.sh` es `bash "<carpeta de esta skill>/scripts/gh.sh"`.
- **Cuerpo**: Léelo con `gh.sh pr view M --json body --jq .body`, escribe el cuerpo corregido en un fichero temporal y guárdalo con `gh.sh pr edit M --body-file FICHERO`.
- **Development**: `gh.sh api graphql`.

La carpeta de esta skill es la que contiene este `SKILL.md`: en opencode, Cursor y Codex, `.agents/skills/link-pr-to-issue`; en Claude Code, `${CLAUDE_SKILL_DIR}`.

#### En GitLab

Abajo, `gitlab.mjs` es `node "<carpeta de esta skill>/scripts/gitlab.mjs"`, desde la raíz del repositorio git. Usa el `GITLAB_TOKEN` del `.env` del proyecto. La pull request es el merge request.

- **Cuerpo**: Léelo en el campo `body` de `gitlab.mjs mr view M`, escribe el cuerpo corregido en un fichero temporal y guárdalo con `gitlab.mjs mr edit M --body-file FICHERO`.
- **Enlace**: La línea `Closes #N` enlaza la issue: no hay paso Development ni más llamadas. GitLab la cierra al fusionar en la rama por defecto.

#### Especificación de Argumentos

1. **Pull request** _(Obligatorio)_: La URL o el número de la pull request que acaba de abrirse.
2. **Issue** _(Obligatorio)_: El número de la issue. En la sección Issue del cuerpo tiene que quedar la línea `Closes #N`.

#### Reglas de Invocación Críticas

- **Cuerpo**: Conserva el resto del cuerpo en español. Si `Closes #N` ya está, no lo dupliques. Si la sección Issue tiene `Related to #N` u otra línea suelta con el número, sustitúyela por `Closes #N`. El número de la issue solo va en esa línea: si el cuerpo lo nombra en otra sección («El detalle está en la issue #N»), quítalo de ahí.
- **Development**: Lee el id de nodo de la issue y el de la pull request con `gh.sh`. Luego llama a `addCloseIssueReferences`. Eso es la barra Development. `issueId` es el id de la issue. `pullRequestIds` lleva el id de la pull request. `OWNER` y `REPO` salen de `gh.sh repo view --json owner,name`.

Los ids:

```
bash "<carpeta de esta skill>/scripts/gh.sh" api graphql -f query='query($owner:String!,$name:String!,$issue:Int!,$pr:Int!) { repository(owner:$owner, name:$name) { issue(number:$issue) { id } pullRequest(number:$pr) { id } } }' -f owner=OWNER -f name=REPO -F issue=N -F pr=M
```

El enlace:

```
bash "<carpeta de esta skill>/scripts/gh.sh" api graphql -f query='mutation($issueId:ID!,$pullRequestId:ID!) { addCloseIssueReferences(input:{issueId:$issueId, pullRequestIds:[$pullRequestId]}) { issue { number } } }' -f issueId=ID_DE_LA_ISSUE -f pullRequestId=ID_DE_LA_PULL_REQUEST
```

La issue sigue abierta después de enlazarla: GitHub la cierra al fusionar la pull request que lleva `Closes #N` en la rama por defecto del repositorio. Si la rama base es otra (por ejemplo `staging` cuando la rama por defecto es `main`), fusionar en la rama base no la cierra.

- **Si falla**: Comunica el error y deja el enlace pendiente. Solo da la issue por enlazada cuando el forge lo confirme. En GitHub, si `gh` no está instalado o falta el token del `.env`, dilo: el cuerpo ya lleva `Closes #N`, solo falta el enlace en Development.
