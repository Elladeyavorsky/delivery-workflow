#!/usr/bin/env bash
# Prueba los scripts del paquete contra un remoto falso y un gh falso.
# Uso: bash tests/scripts.test.sh

set -uo pipefail

package=$(cd "$(dirname "$0")/.." && pwd)
skills="${package}/.apm/skills"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0

check() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ok    ${name}"
  else
    echo "FALLA ${name}"
    failures=$((failures + 1))
  fi
}

# gh falso: anota cada llamada y responde lo justo.
mkdir -p "${work}/bin"
cat >"${work}/bin/gh" <<'GH'
#!/usr/bin/env bash
echo "$*" >>"$FAKE_GH_LOG"
echo "${GH_TOKEN:-}" >"$FAKE_GH_TOKEN"
case "$1 $2" in
  "label list") [[ -n "${FAKE_GH_LABELS:-}" ]] && echo "$FAKE_GH_LABELS"; exit 0 ;;
  "label create") [[ "${FAKE_GH_LABEL_DENIED:-}" == 1 ]] && exit 1; exit 0 ;;
  "pr list") [[ -n "${FAKE_GH_PR_URL:-}" ]] && echo "$FAKE_GH_PR_URL"; exit 0 ;;
  "pr view") echo '{"number":9,"reviewDecision":"CHANGES_REQUESTED","body":"Closes #1"}'; exit 0 ;;
  "issue create") echo "https://github.com/owner/repo/issues/7"; exit 0 ;;
  "issue view") echo '{"body":"hola"}'; exit 0 ;;
  "pr create") echo "https://github.com/owner/repo/pull/9"; exit 0 ;;
  "api user") [[ "$*" == *--include* ]] && printf 'HTTP/2.0 200 OK\netag: "u"\n\n{"login":"ada"}\n' || echo ada; exit 0 ;;
  "api repos/owner/repo/collaborators?per_page=100&page=1") printf 'HTTP/2.0 200 OK\netag: "c"\n\n[{"login":"ada"}]\n'; exit 0 ;;
esac
exit 0
GH
chmod +x "${work}/bin/gh"
export PATH="${work}/bin:${PATH}"
export FAKE_GH_LOG="${work}/gh.log"
export FAKE_GH_TOKEN="${work}/gh.token"
unset GIT_WORKFLOW_BASE

git init -q --bare -b main "${work}/origin.git"
git clone -q "${work}/origin.git" "${work}/repo" 2>/dev/null
cd "${work}/repo"
git config user.email test@example.com
git config user.name Test
echo .env >.gitignore
git add .gitignore
git commit -q -m init
echo "GITHUB_TOKEN=token-del-env" >.env
git push -q origin HEAD:main HEAD:staging
git fetch -q origin

# gh.sh: gh con el token del .env, no con el del entorno ni con la sesión de gh.
ghsh="${skills}/manage-issue/scripts/gh.sh"
check "gh.sh lanza gh" env GH_TOKEN=token-de-la-sesion GITHUB_TOKEN=token-de-la-sesion bash "$ghsh" repo view
check "gh.sh pasa el token del .env" test "$(cat "$FAKE_GH_TOKEN")" = token-del-env
printf '# comentario\nexport GITHUB_TOKEN = "token con comillas"\r\n' >.env
check "gh.sh rechaza un token con espacios" bash -c "! bash '$ghsh' repo view 2>/dev/null"
printf '# comentario\nexport GITHUB_TOKEN="token-entre-comillas"\r\n' >.env
bash "$ghsh" repo view >/dev/null 2>&1
check "gh.sh quita export, comillas y retorno de carro" test "$(cat "$FAKE_GH_TOKEN")" = token-entre-comillas
mv .env env.bak
: >"$FAKE_GH_LOG"
check "sin .env, gh.sh falla" bash -c "! bash '$ghsh' repo view 2>/dev/null"
check "sin .env, no se llama a gh" test ! -s "$FAKE_GH_LOG"
check "sin .env, ensure-label sale con 3" bash -c "bash '${skills}/manage-issue/scripts/ensure-label.sh' feat 2>/dev/null; test \$? -eq 3"
mv env.bak .env
git rm -q --cached .gitignore && mv .gitignore gitignore.bak
check "con el .env fuera de .gitignore, gh.sh falla" bash -c "! bash '$ghsh' repo view 2>/dev/null"
mv gitignore.bak .gitignore && git add .gitignore
printf 'GITHUB_TOKEN=token-con-comentario  # mi token\n' >.env
bash "$ghsh" repo view >/dev/null 2>&1
check "gh.sh quita un comentario detrás del token" test "$(cat "$FAKE_GH_TOKEN")" = token-con-comentario
printf 'GITHUB_TOKEN="token-entre-comillas" # mi token\n' >.env
bash "$ghsh" repo view >/dev/null 2>&1
check "gh.sh quita un comentario detrás de las comillas" test "$(cat "$FAKE_GH_TOKEN")" = token-entre-comillas
echo "GITHUB_TOKEN=token-del-env" >.env
check "gh.sh deja el token para GitHub Enterprise" test "$(bash -c "source '$ghsh'; load_github_token; echo \$GH_ENTERPRISE_TOKEN")" = token-del-env
git worktree add -q "${work}/worktree" -b worktree-test 2>/dev/null
check "en un worktree, gh.sh usa el .env de la copia principal" bash -c "cd '${work}/worktree' && bash '$ghsh' repo view"
check "en un worktree, el token es el del .env" test "$(cat "$FAKE_GH_TOKEN")" = token-del-env
git worktree remove --force "${work}/worktree"
git branch -q -D worktree-test
for copy in "${skills}"/*/scripts/gh.sh; do
  check "gh.sh es igual en $(basename "$(dirname "$(dirname "$copy")")")" cmp -s "$ghsh" "$copy"
done

# manage-branch: siete tipos, knowledge incluido; los demás se rechazan.
check "manage-branch acepta knowledge" "${skills}/manage-branch/scripts/manage-branch.sh" 5 knowledge add-notes
check "la rama sale de staging sin seguirla" test -z "$(git config branch.5-knowledge-add-notes.merge)"
check "manage-branch rechaza un tipo mal escrito" bash -c "! '${skills}/manage-branch/scripts/manage-branch.sh' 6 feta x 2>/dev/null"

# manage-empty-commit: abre la rama y se niega en la rama base.
check "manage-empty-commit en la rama de trabajo" "${skills}/manage-empty-commit/scripts/manage-empty-commit.sh" 5
check "el commit vacío es chore: open #5" test "$(git log -1 --format=%s)" = "chore: open #5"
git switch -q -c staging origin/staging 2>/dev/null
check "manage-empty-commit se niega en staging" bash -c "! '${skills}/manage-empty-commit/scripts/manage-empty-commit.sh' 5 2>/dev/null"
git switch -q 5-knowledge-add-notes

# ensure-label: existe, se crea, o no hay permiso (2), o el tipo no vale (1).
label="${skills}/manage-issue/scripts/ensure-label.sh"
FAKE_GH_LABELS=feat check "ensure-label con la etiqueta ya creada" "$label" feat
check "ensure-label crea la que falta" "$label" knowledge
check "ensure-label creó knowledge" grep -q "label create knowledge" "$FAKE_GH_LOG"
FAKE_GH_LABELS=Knowledge FAKE_GH_LABEL_DENIED=1 check "ensure-label acepta la etiqueta con otras mayúsculas" "$label" knowledge
FAKE_GH_LABEL_DENIED=1 "$label" fix >/dev/null 2>&1
check "ensure-label sin permiso sale con 2" test $? -eq 2
"$label" feta >/dev/null 2>&1
check "ensure-label rechaza un tipo mal escrito" test $? -eq 1
check "ensure-label es igual en manage-issue y manage-pr-base" cmp -s "$label" "${skills}/manage-pr-base/scripts/ensure-label.sh"

# check-title: inglés con verbo delante, sin tipo, sin número y con menos de 72 caracteres.
title="${skills}/manage-issue/scripts/check-title.sh"
check "check-title acepta un título bien formado" bash "$title" "Add a delivery-workflow test note"
check "check-title rechaza el tipo delante" bash -c "! bash '$title' 'docs: add a test note' 2>/dev/null"
check "check-title rechaza el tipo con ámbito delante" bash -c "! bash '$title' 'feat(login): add the form' 2>/dev/null"
check "check-title rechaza el número de la issue" bash -c "! bash '$title' 'Add the note for #50' 2>/dev/null"
check "check-title rechaza la minúscula inicial" bash -c "! bash '$title' 'add a test note' 2>/dev/null"
check "check-title rechaza el punto final" bash -c "! bash '$title' 'Add a test note.' 2>/dev/null"
check "check-title rechaza 72 caracteres o más" bash -c "! bash '$title' 'Add $(printf 'x%.0s' {1..68})' 2>/dev/null"
check "check-title rechaza acentos y eñes" bash -c "! bash '$title' 'Añadir nota de prueba' 2>/dev/null"
check "check-title rechaza un salto de línea" bash -c "! bash '$title' \$'Add a note\\nSecond line' 2>/dev/null"
check "check-title rechaza el tipo con barra delante" bash -c "bash '$title' 'docs/ui: add a note' 2>&1 | grep -q 'no lleva el tipo'"
check "check-title rechaza el tipo con espacio antes de los dos puntos" bash -c "bash '$title' 'docs : add a note' 2>&1 | grep -q 'no lleva el tipo'"
check "check-title rechaza el tipo en mayúsculas" bash -c "bash '$title' 'Docs(ui)!: add a note' 2>&1 | grep -q 'no lleva el tipo'"
check "check-title acepta dos puntos que no son un tipo" bash "$title" "Note: update the readme"
check "check-title acepta una palabra que empieza como un tipo" bash "$title" "Fixtures: add the login cases"
check "check-title cuenta igual en cualquier locale" bash -c "LC_ALL=en_US.UTF-8 bash '$title' 'Add $(printf 'x%.0s' {1..67})' && ! LC_ALL=en_US.UTF-8 bash '$title' 'Add $(printf 'x%.0s' {1..68})' 2>/dev/null"
check "check-title es igual en manage-issue y manage-pr-base" cmp -s "$title" "${skills}/manage-pr-base/scripts/check-title.sh"

# manage-pr-base: base detectada, draft, asignada y con etiqueta.
echo "cuerpo" >"${work}/body.md"
: >"$FAKE_GH_LOG"
check "manage-pr-base abre la PR" "${skills}/manage-pr-base/scripts/manage-pr-base.sh" 5-knowledge-add-notes "Add notes" "${work}/body.md" knowledge
check "la PR va contra staging, en draft, asignada y con etiqueta" grep -q -- "pr create --base staging --head 5-knowledge-add-notes --title Add notes --body-file ${work}/body.md --draft --assignee @me --label knowledge" "$FAKE_GH_LOG"
: >"$FAKE_GH_LOG"
FAKE_GH_LABEL_DENIED=1 "${skills}/manage-pr-base/scripts/manage-pr-base.sh" 5-knowledge-add-notes "Add notes" "${work}/body.md" fix >/dev/null 2>&1
check "sin permiso de etiquetas, la PR sale sin etiqueta" bash -c "grep -q 'pr create' '$FAKE_GH_LOG' && ! grep -q -- '--label' <(grep 'pr create' '$FAKE_GH_LOG')"
: >"$FAKE_GH_LOG"
check "manage-pr-base no abre la PR con el tipo en el título" bash -c "
  out=\$('${skills}/manage-pr-base/scripts/manage-pr-base.sh' 5-knowledge-add-notes 'docs: add notes' '${work}/body.md' knowledge 2>&1)
  [[ \$? -ne 0 && \$out == *'no lleva el tipo'* ]] && ! grep -q 'pr create' '$FAKE_GH_LOG'"
: >"$FAKE_GH_LOG"
existing=$(FAKE_GH_PR_URL=https://github.com/owner/repo/pull/3 "${skills}/manage-pr-base/scripts/manage-pr-base.sh" 5-knowledge-add-notes "docs: añadir notas" "${work}/body.md" knowledge 2>&1)
check "con la PR ya abierta, manage-pr-base devuelve su URL sin mirar el título" grep -q "ya existía: https://github.com/owner/repo/pull/3" <<<"$existing"
printf 'Closes #\n\nComo pide la issue #12.\n' >"${work}/body-con-numero.md"
check "con la PR ya abierta, manage-pr-base tampoco mira el cuerpo" bash -c "FAKE_GH_PR_URL=https://github.com/owner/repo/pull/3 '${skills}/manage-pr-base/scripts/manage-pr-base.sh' 5-knowledge-add-notes 'Add notes' '${work}/body-con-numero.md' knowledge | grep -q 'ya existía'"
check "con la PR ya abierta, no se crea otra" bash -c "! grep -q 'pr create' '$FAKE_GH_LOG'"

: >"$FAKE_GH_LOG"
check "manage-pr-base rechaza un cuerpo que nombra la issue" bash -c "
  out=\$('${skills}/manage-pr-base/scripts/manage-pr-base.sh' 5-knowledge-add-notes 'Add notes' '${work}/body-con-numero.md' knowledge 2>&1)
  [[ \$? -ne 0 && \$out == *'no nombra la issue'* ]] && ! grep -q 'pr create' '$FAKE_GH_LOG'"
GIT_WORKFLOW_BASE=main "${skills}/manage-pr-base/scripts/manage-pr-base.sh" 5-knowledge-add-notes "Add notes" "${work}/body.md" feat >/dev/null 2>&1
check "GIT_WORKFLOW_BASE cambia la base" grep -q -- "pr create --base main" "$FAKE_GH_LOG"

# manage-issue: comprueba el título antes de llamar a gh, con etiqueta y asignada.
: >"$FAKE_GH_LOG"
check "manage-issue crea la issue" "${skills}/manage-issue/scripts/manage-issue.sh" "Add notes" "${work}/body.md" knowledge
check "la issue va asignada y con etiqueta" grep -q -- "issue create --title Add notes --body-file ${work}/body.md --assignee @me --label knowledge" "$FAKE_GH_LOG"
: >"$FAKE_GH_LOG"
check "manage-issue no crea la issue con el tipo en el título" bash -c "
  out=\$('${skills}/manage-issue/scripts/manage-issue.sh' 'docs: add notes' '${work}/body.md' knowledge 2>&1)
  [[ \$? -ne 0 && \$out == *'no lleva el tipo'* ]] && test ! -s '$FAKE_GH_LOG'"
: >"$FAKE_GH_LOG"
FAKE_GH_LABEL_DENIED=1 "${skills}/manage-issue/scripts/manage-issue.sh" "Add notes" "${work}/body.md" fix >/dev/null 2>&1
check "sin permiso de etiquetas, la issue sale sin etiqueta" bash -c "grep -q 'issue create' '$FAKE_GH_LOG' && ! grep -q -- '--label' <(grep 'issue create' '$FAKE_GH_LOG')"

# github-cache: el fichero vive en .git/ y no aparece como cambio.
node "${skills}/github-cache/scripts/github-cache.mjs" directory owner/repo >/dev/null
check "la caché se guarda en .git/" test -f .git/.git-workflow-cache.json
check "la caché no se guarda en la raíz" test ! -e .git-workflow-cache.json
check "la caché usa el token del .env" test "$(cat "$FAKE_GH_TOKEN")" = token-del-env
check "git no ve la caché" test -z "$(git status --porcelain)"

# issue-spec: lee la issue con el token del .env.
check "issue-spec lee la issue" test "$(node "${skills}/issue-spec/scripts/issue-spec.mjs" read 1)" = hola
check "issue-spec usa el token del .env" test "$(cat "$FAKE_GH_TOKEN")" = token-del-env
check "ISSUE_SPEC_GH no salta gh.sh" test "$(ISSUE_SPEC_GH=/usr/bin/false node "${skills}/issue-spec/scripts/issue-spec.mjs" read 1)" = hola

# check-status: informa del token del .env, de su cuenta y de Node.
status=$("${skills}/check-status/scripts/check-status.sh")
check "check-status lee el token del .env" grep -q "^Token de GitHub: GITHUB_TOKEN en .env" <<<"$status"
check "check-status dice la cuenta del token" grep -q "^GitHub CLI: cuenta ada" <<<"$status"
check "check-status informa de Node" grep -q "^Node:" <<<"$status"
check "check-status informa de la pull request" grep -q "^Pull request: #9 CHANGES_REQUESTED issue #1" <<<"$status"

# check-status: pide Node 24. El node falso solo responde la versión.
mkdir -p "${work}/fake-node"
cat >"${work}/fake-node/node" <<'NODE'
#!/usr/bin/env bash
[[ "$1" == -p ]] && echo "$FAKE_NODE_VERSION" && exit 0
exit 1
NODE
chmod +x "${work}/fake-node/node"
status=$(PATH="${work}/fake-node:${PATH}" FAKE_NODE_VERSION=23.7.0 "${skills}/check-status/scripts/check-status.sh")
check "check-status pide Node 24 con una versión anterior" grep -qx "Node: 23.7.0. Hace falta Node 24 o superior." <<<"$status"
status=$(PATH="${work}/fake-node:${PATH}" FAKE_NODE_VERSION=24.0.0 "${skills}/check-status/scripts/check-status.sh")
check "check-status acepta Node 24" grep -qx "Node: 24.0.0" <<<"$status"
# Un PATH solo con lo que el script necesita: así no depende de dónde esté instalado node.
mkdir -p "${work}/no-node"
for tool in basename bash cat dirname env git grep mktemp rm sed tail; do
  ln -s "$(command -v "$tool")" "${work}/no-node/${tool}"
done
status=$(PATH="${work}/bin:${work}/no-node" "${skills}/check-status/scripts/check-status.sh" 2>&1)
check "check-status sin Node lo dice" grep -qx "Node: no instalado. Hace falta Node 24 o superior." <<<"$status"
check "check-status sin Node dice que no comprueba la pull request" grep -qx "Pull request: no se pudo comprobar (falta Node)" <<<"$status"
check "check-status sin Node llega al final" grep -q "^Sin seguimiento:" <<<"$status"
status=$("${skills}/check-status/scripts/check-status.sh")

# check-status: la línea de modelos nunca para el script y pasa por sus tres estados.
check "check-status avisa de que no hay agentes de Cursor" grep -q "^Modelos: sin configurar" <<<"$status"
mkdir -p .cursor/agents
for agent in "${package}"/.apm/agents/*.agent.md; do
  cp "$agent" ".cursor/agents/$(basename "${agent%.agent.md}").md"
done
status=$("${skills}/check-status/scripts/check-status.sh")
check "check-status dice sin configurar con agentes y sin elecciones" grep -q "^Modelos: sin configurar" <<<"$status"
# cursor-agent falso con la lista del fixture: la prueba no depende de lo instalado ni de ninguna cuenta.
cat >"${work}/bin/cursor-agent" <<CA
#!/usr/bin/env bash
cat "${package}/tests/fixtures/configure-models/cursor-agent-models.txt"
CA
chmod +x "${work}/bin/cursor-agent"
check "apply funciona con un cursor-agent falso" node "${skills}/configure-models/scripts/configure-models.mjs" apply --set manage-branch=composer-2.5
status=$("${skills}/check-status/scripts/check-status.sh")
check "check-status dice configurado" grep -q "^Modelos: configurado (cursor 9/9)" <<<"$status"
cp "${package}/.apm/agents/manage-pr.agent.md" .cursor/agents/manage-pr.md
status=$("${skills}/check-status/scripts/check-status.sh")
check "check-status dice desincronizado" grep -q "^Modelos: desincronizado (cursor 8/9)" <<<"$status"
check "check-status sigue entero tras la línea de modelos" grep -q "^Último commit:" <<<"$status"
mkdir -p "${work}/solo/check-status/scripts"
cp "${skills}/check-status/scripts/"*.sh "${work}/solo/check-status/scripts/"
status=$("${work}/solo/check-status/scripts/check-status.sh")
check "check-status sin la skill configure-models sigue y lo dice" grep -q "^Modelos: no se pudo comprobar" <<<"$status"
check "check-status sin la skill configure-models llega al final" grep -q "^Sin seguimiento:" <<<"$status"
rm -rf .cursor

# Las skills lanzan sus scripts con bash o node: así una regla de permisos vale para todos.
commands=$(grep -rhoE '`[^`]*<carpeta de esta skill>/scripts/[^`]*`' "${skills}")
check "las skills nombran sus scripts" test -n "$commands"
check "las skills lanzan sus scripts con bash o node" bash -c '! grep -vE "^\`(bash|node) " <<<"$1"' _ "$commands"

# Skills de gestión: existen, y no quedan nombres create-* ni skills en español.
for skill in edit-pull-request ready-pull-request close-issue; do
  check "la skill ${skill} existe" test -f "${skills}/${skill}/SKILL.md"
done
check "no quedan nombres create-* en .apm" bash -c "! grep -rqE 'create-(issue|branch|commit|pr|draft|empty-commit)' '${package}/.apm'"
check "no quedan skills con nombre en español" bash -c "! ls '${skills}' | grep -qE '^entrevista-'"

# release-version: la versión de apm.yml, sin etiqueta y mayor que la última.
release="${package}/.github/scripts/release-version.sh"
git init -q "${work}/release"
cd "${work}/release"
git config user.email test@example.com
git config user.name Test
echo 'version: "0.1.0"' >apm.yml
git add apm.yml
git commit -q -m init
check "release-version sin etiquetas escribe la versión" test "$(bash "$release")" = 0.1.0
git tag v0.1.0
check "release-version falla si la etiqueta ya existe" bash -c "! bash '$release' 2>/dev/null"
echo 'version: "0.1.1"' >apm.yml
check "release-version acepta la versión siguiente" test "$(bash "$release")" = 0.1.1
git tag v0.10.0
check "release-version falla con una versión menor que la última" bash -c "! bash '$release' 2>/dev/null"
echo 'version: 0.11.0' >apm.yml
check "release-version compara por números y acepta sin comillas" test "$(bash "$release")" = 0.11.0
echo "version: '0.11.1'" >apm.yml
check "release-version acepta comillas simples" test "$(bash "$release")" = 0.11.1
echo "version: '0.11.1\"" >apm.yml
check "release-version falla con comillas que no cierran" bash -c "! bash '$release' 2>/dev/null"
printf 'version: "0.11.2"\nversion: "0.11.3"\n' >apm.yml
check "release-version usa solo la primera línea version" test "$(bash "$release")" = 0.11.2
git tag v0.12.0-rc1
echo 'version: "0.11.2"' >apm.yml
check "release-version no cuenta una etiqueta con sufijo" test "$(bash "$release")" = 0.11.2
echo 'version: "1.0"' >apm.yml
check "release-version falla sin X.Y.Z" bash -c "! bash '$release' 2>/dev/null"

# say-it-straight: skill de prosa sin scripts.
check "say-it-straight existe" test -f "${skills}/say-it-straight/SKILL.md"
check "say-it-straight declara su name" grep -q "^name: say-it-straight" "${skills}/say-it-straight/SKILL.md"
check "say-it-straight deja los commits en inglés fuera de alcance" grep -q "commit-changes" "${skills}/say-it-straight/SKILL.md"
for agent in concept-developer concept-tester manage-issue manage-pr; do
  check "${agent} precarga say-it-straight" grep -q -- "- say-it-straight" "${package}/.apm/agents/${agent}.agent.md"
done

# docker-best-practices: check-docker.sh avisa de lo que no tiene versión fija.
checkdocker="${skills}/docker-best-practices/scripts/check-docker.sh"
mkdir -p "${work}/docker-good" "${work}/docker-bad"
cat >"${work}/docker-good/Dockerfile" <<'DOCKERFILE'
FROM node:24.22.3-trixie AS base
ARG TOOL_SHA256=abc
RUN npm install --global "pnpm@10.33.0"
RUN curl -fsSL -o /tmp/t.tgz https://example.org/t.tgz \
  && echo "${TOOL_SHA256}  /tmp/t.tgz" | sha256sum -c -
USER node
FROM base AS gui
USER root
RUN apt-get update --snapshot 20261116T000000Z \
  && apt-get install -y --no-install-recommends --snapshot 20261116T000000Z \
    libgtk-3-0t64=3.24.49-3 \
  && rm -rf /var/lib/apt/lists/*
USER node
DOCKERFILE
echo '*' >"${work}/docker-good/.dockerignore"
cat >"${work}/docker-bad/Dockerfile" <<'DOCKERFILE'
FROM node:24-bookworm
RUN apt-get update && apt-get install -y python3-venv
RUN npm install --global pnpm
RUN pip install apm-cli
RUN curl -fsSL -o /tmp/t.tgz https://example.org/t.tgz
RUN apt-get update
DOCKERFILE
mkdir -p "${work}/docker-cache"
cat >"${work}/docker-cache/Dockerfile" <<'DOCKERFILE'
FROM debian:trixie-20261104-slim
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update --snapshot 20261116T000000Z \
    && apt-get install -y --no-install-recommends --snapshot 20261116T000000Z curl=8.14.1-2
USER nobody
DOCKERFILE
echo '*' >"${work}/docker-cache/.dockerignore"
check "check-docker no avisa de un Dockerfile con todo fijado" bash "$checkdocker" "${work}/docker-good/Dockerfile"
bad=$(bash "$checkdocker" "${work}/docker-bad/Dockerfile" 2>&1) && bad_status=0 || bad_status=$?
check "check-docker sale con 1 si hay avisos" test "$bad_status" -eq 1
check "check-docker avisa de FROM sin versión exacta" grep -q ":1: FROM node:24-bookworm" <<<"$bad"
check "check-docker avisa de apt-get sin versión" grep -q "apt-get install sin versión fija: python3-venv" <<<"$bad"
check "check-docker avisa de apt-get sin --snapshot" grep -q "apt-get sin --snapshot" <<<"$bad"
check "check-docker avisa de npm --global sin versión" grep -q "npm install --global sin versión: pnpm" <<<"$bad"
check "check-docker avisa de pip sin versión" grep -q "pip install sin versión: apm-cli" <<<"$bad"
check "check-docker avisa de curl sin sha256sum" grep -q "curl o wget sin comprobar su sha256sum" <<<"$bad"
check "check-docker avisa de apt-get update sin install en el mismo RUN" grep -q ":6: apt-get update sin apt-get install" <<<"$bad"
check "check-docker acepta la caché de apt montada con BuildKit" bash "$checkdocker" "${work}/docker-cache/Dockerfile"
check "check-docker avisa si la imagen termina con root" grep -q "termina con root" <<<"$bad"
check "check-docker avisa si falta .dockerignore" grep -q "no hay .dockerignore" <<<"$bad"
check "check-docker sale con 2 si falta el Dockerfile" bash -c "bash '$checkdocker' '${work}/no-existe' 2>/dev/null; test \$? -eq 2"
for reference in versiones-fijas cache-de-capas compose-y-volumenes devcontainer gui-en-contenedores; do
  check "docker-best-practices enlaza references/${reference}.md" grep -q "references/${reference}.md" "${skills}/docker-best-practices/SKILL.md"
  check "docker-best-practices trae references/${reference}.md" test -f "${skills}/docker-best-practices/references/${reference}.md"
done


# data-protection-guideline: guía orientativa sin scripts.
dpg="${skills}/data-protection-guideline/SKILL.md"
check "data-protection-guideline existe" test -f "$dpg"
check "data-protection-guideline declara su name" grep -q "^name: data-protection-guideline" "$dpg"
check "data-protection-guideline dice que no actúa sin la sección" grep -qF "«Protección de datos: el proyecto no declara datos personales; la guía no actúa.»" "$dpg"
check "data-protection-guideline usa la salida sin hallazgos y no dice cumple" bash -c "grep -qF 'Sin hallazgos frente al checklist vX.Y.Z (AAAA-MM-DD).' '$dpg' && ! grep -qi 'cumple' '$dpg'"
frontmatter() {
  awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { exit } inside { print }' "$1"
}
for agent in concept-developer concept-tester legal-advisor; do
  check "${agent} precarga data-protection-guideline" bash -c "$(declare -f frontmatter); frontmatter '${package}/.apm/agents/${agent}.agent.md' | grep -qx '  - data-protection-guideline'"
done
for agent in code-developer code-tester; do
  check "${agent} no precarga data-protection-guideline" bash -c "$(declare -f frontmatter); ! frontmatter '${package}/.apm/agents/${agent}.agent.md' | grep -q 'data-protection-guideline'"
done

# legal-advisor: agente del paquete, sin mcpServers (el MCP va en apm.yml).
la="${package}/.apm/agents/legal-advisor.agent.md"
check "legal-advisor declara su name" bash -c "$(declare -f frontmatter); frontmatter '$la' | grep -qx 'name: legal-advisor'"
for skill in issue-spec say-it-straight; do
  check "legal-advisor precarga ${skill}" bash -c "$(declare -f frontmatter); frontmatter '$la' | grep -qx '  - ${skill}'"
done
check "legal-advisor no declara mcpServers" bash -c "$(declare -f frontmatter); ! frontmatter '$la' | grep -q 'mcpServers'"
check "legal-advisor nombra el MCP eur-lex" grep -q 'eur-lex' "$la"
check "legal-advisor dice que no certifica cumplimiento" grep -qF "Orientativo: no certifica cumplimiento." "$la"
check "legal-advisor avisa sin Node 24" grep -qF "No se usó EUR-Lex: el MCP necesita Node 24 o superior." "$la"
check "legal-advisor está en agent-profiles con nivel pesado" node -e '
  const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  process.exit(p.agents?.["legal-advisor"]?.tier === "heavy" ? 0 : 1);
' "${skills}/configure-models/assets/agent-profiles.json"
check "el paquete tiene 9 agentes" test "$(ls "${package}"/.apm/agents/*.agent.md | wc -l | tr -d ' ')" = 9
for agent in concept-developer concept-tester; do
  check "${agent} no usa el MCP eur-lex" grep -qF 'No usa el MCP `eur-lex`' "${package}/.apm/agents/${agent}.agent.md"
  check "${agent} devuelve «Consultas legales»" grep -qF "Consultas legales" "${package}/.apm/agents/${agent}.agent.md"
done

# apm.yml: el MCP eur-lex viaja con el paquete, fijado a una versión.
check "apm.yml declara el MCP eur-lex en dependencies.mcp" bash -c "grep -q '^  mcp:' '${package}/apm.yml' && grep -qF -- '- name: eur-lex' '${package}/apm.yml'"
check "apm.yml fija el MCP a 0.21.0" grep -qF '@cyanheads/eur-lex-mcp-server@0.21.0' "${package}/apm.yml"
check "apm.yml no usa latest" bash -c "! grep -q 'eur-lex-mcp-server@latest' '${package}/apm.yml'"

# delivery-workflow: consultas legales sin gastar ronda.
dw="${skills}/delivery-workflow/SKILL.md"
check "delivery-workflow llama a legal-advisor sin gastar ronda" bash -c "grep -qF '**Consultas legales:**' '$dw' && grep -qF 'No gasta ronda' '$dw' && grep -qF 'Un \`legal-advisor\` nuevo' '$dw'"
check "delivery-workflow pasa las respuestas a concept-developer" grep -qF '`concept-developer` con la ronda actual (0 si viene de la spec), las respuestas de `legal-advisor`' "$dw"
check "delivery-workflow nombra las consultas en el comentario de la ronda" grep -qF "los ids de las consultas legales" "$dw"
check "delivery-workflow pasa el primer id CL-NN libre a los dos agentes" grep -qF 'el encargo de `concept-developer` y de `concept-tester` lleva el primer id libre, que empieza en `CL-01`' "$dw"
for agent in concept-developer concept-tester; do
  check "${agent} recibe el primer id CL-NN libre sin valor por defecto" bash -c "grep -qF 'primer id \`CL-NN\` libre' '${package}/.apm/agents/${agent}.agent.md' && grep -qF 'desde el primer id libre del encargo' '${package}/.apm/agents/${agent}.agent.md' && ! grep -qiE 'por defecto|CL-01 si|empieza en .?CL-01' '${package}/.apm/agents/${agent}.agent.md'"
done
check "delivery-workflow nombra legal-advisor en herramientas" grep -qF '**Subagente `legal-advisor`:**' "$dw"

# setup-discord-notifications: skill instalable y apagada por defecto.
sd="${skills}/setup-discord-notifications"
check "setup-discord-notifications declara su name" grep -qx "name: setup-discord-notifications" "${sd}/SKILL.md"
check "setup-discord-notifications trae una description en español" bash -c "$(declare -f frontmatter); frontmatter '${sd}/SKILL.md' | grep -qE '^description: .*(Activa|Úsala)'"
check "setup-discord-notifications nombra detect" grep -q 'detect' "${sd}/SKILL.md"
check "setup-discord-notifications trae el script y las tres plantillas de workflows" bash -c "test -f '${sd}/scripts/setup-discord-notifications.mjs' && for w in discord-pr-trigger discord-pr-confirmation-trigger discord-pr-publish; do test -f '${sd}/assets/workflows/'\$w.yml || exit 1; done"
check "setup-discord-notifications trae la copia de la acción" test -f "${sd}/assets/discord-pr-notifications/action.yml"
check "apm.yml no declara workflows ni Discord: instalar no activa nada" bash -c "! grep -qiE 'discord|workflows' '${package}/apm.yml'"
check "detect no escribe en el proyecto" bash -c "d=\$(mktemp -d) && git -C \$d init -q && git -C \$d remote add origin https://github.com/acme/app.git && node '${sd}/scripts/setup-discord-notifications.mjs' detect --root \$d >/dev/null 2>&1; [[ -z \$(find \$d -mindepth 1 -not -path '*/.git' -not -path '*/.git/*') ]]"

# setup-compliance: skill instalable con sus plantillas.
sc="${skills}/setup-compliance"
check "setup-compliance declara su name" grep -qx "name: setup-compliance" "${sc}/SKILL.md"
check "setup-compliance trae una description en español" bash -c "$(declare -f frontmatter); frontmatter '${sc}/SKILL.md' | grep -qE '^description: .*(Genera|documentación|Úsala)'"
check "setup-compliance nombra detect y write" bash -c "grep -q 'detect' '${sc}/SKILL.md' && grep -q 'write' '${sc}/SKILL.md'"
for t in ai-act dpia model-card data-card system-card security; do
  check "plantilla ${t} termina con la línea orientativa" bash -c "[[ \"\$(grep -v '^[[:space:]]*\$' '${sc}/assets/${t}.md' | tail -n 1)\" == 'Documento orientativo: no certifica cumplimiento ni es asesoramiento jurídico.' ]]"
  check "plantilla ${t} trae Fuente: y hueco y no dice cumple" bash -c "grep -q '^Fuente:' '${sc}/assets/${t}.md' && grep -qF '> **Hueco:**' '${sc}/assets/${t}.md' && ! grep -qi 'cumple' '${sc}/assets/${t}.md'"
done
check "setup-compliance trae la lista de señales de IA" test -f "${sc}/assets/ai-signals.json"
check "la guía del AI Act cita el CELEX 32024R1689" grep -qF "32024R1689" "${sc}/assets/ai-act-classification.md"
for n in 5 6 50; do
  check "el artículo ${n} del Reglamento de IA está guardado con su CELEX" bash -c "grep -qF 'Artículo ${n}' '${sc}/assets/reglamento-ia/articulo-${n}.md' && grep -qF '32024R1689' '${sc}/assets/reglamento-ia/articulo-${n}.md'"
done
check "el paso del art. 50 cita los apartados 1 a 6 y los dos roles" bash -c "step=\$(sed -n '/^### 5\\. Transparencia/,/^### 6\\./p' '${sc}/assets/ai-act-classification.md'); for a in 50.1 50.2 50.3 50.4 50.5 50.6; do grep -qF \"art. \$a\" <<<\"\$step\" || grep -qF \"\$a)\" <<<\"\$step\" || exit 1; done; grep -qF 'proveedor' <<<\"\$step\" && grep -qF 'responsable del despliegue' <<<\"\$step\""
check "el anexo III del Reglamento de IA está guardado con su CELEX" bash -c "grep -qF 'Anexo III' '${sc}/assets/reglamento-ia/anexo-III.md' && grep -qF '32024R1689' '${sc}/assets/reglamento-ia/anexo-III.md'"
check "el paso 1 recorre las letras a) a h) del art. 5.1 con sus excepciones" bash -c "step=\$(sed -n '/^### 1\\. Prácticas/,/^### 2\\./p' '${sc}/assets/ai-act-classification.md'); for l in a b c d e f g h; do grep -qF -- \"- **\$l)**\" <<<\"\$step\" || exit 1; done; grep -qF 'motivos médicos o de seguridad' <<<\"\$step\" && grep -qF 'hechos objetivos y verificables' <<<\"\$step\""
check "el paso 4 recorre las condiciones a) a d) del art. 6.3 y el registro del 6.4" bash -c "step=\$(sed -n '/^### 4\\. Excepciones/,/^### 5\\./p' '${sc}/assets/ai-act-classification.md'); for l in a b c d; do grep -qF -- \"- **\$l)**\" <<<\"\$step\" || exit 1; done; grep -qF 'art. 49.2' <<<\"\$step\" && grep -qF 'puesta en servicio' <<<\"\$step\" || grep -qF 'ponerlo en servicio' <<<\"\$step\""
check "el paso del art. 50 no se salta en alto riesgo" bash -c "grep -qF 'El paso 5 se evalúa además' '${sc}/assets/ai-act-classification.md' && ! grep -qF 'pasos en este orden y para en el primero' '${sc}/assets/ai-act-classification.md'"

# layered-architecture-guideline: skill, plantilla y precarga; sin verificador de un stack.
lag="${skills}/layered-architecture-guideline"
tpl="${lag}/assets/ARCHITECTURE.template.md"
check "layered-architecture-guideline existe" test -f "${lag}/SKILL.md"
for ref in errors flow-and-validation paradigm-and-signatures tests names-and-folders frameworks; do
  check "layered-architecture-guideline trae references/${ref}.md" test -f "${lag}/references/${ref}.md"
done
check "layered-architecture-guideline trae assets/ARCHITECTURE.template.md" test -f "$tpl"
check "layered-architecture-guideline trae assets/layered-architecture-guide.md" test -f "${lag}/assets/layered-architecture-guide.md"
check "SKILL.md nombra la guía condensada como último recurso" grep -q 'layered-architecture-guide.md' "${lag}/SKILL.md"
check "docs/research no duplica la guía de capas" bash -c "! test -e '${package}/docs/research/arquitectura-en-capas.md'"
for agent in concept-developer code-developer; do
  check "${agent} precarga layered-architecture-guideline" bash -c "$(declare -f frontmatter); frontmatter '${package}/.apm/agents/${agent}.agent.md' | grep -qx '  - layered-architecture-guideline'"
done
for agent in code-tester concept-tester; do
  check "${agent} no precarga layered-architecture-guideline" bash -c "$(declare -f frontmatter); ! frontmatter '${package}/.apm/agents/${agent}.agent.md' | grep -q 'layered-architecture-guideline'"
done
check "la plantilla tiene Herramienta, Comando y R-EST-06 (DEF)" bash -c "grep -q 'Herramienta:' '$tpl' && grep -q 'Comando:' '$tpl' && grep -qF 'R-EST-06 (DEF)' '$tpl'"
check "layered-architecture-guideline no trae scripts ni .cjs de un stack" bash -c "! test -e '${lag}/scripts/check-boundaries.sh' && ! test -e '${lag}/assets/boundaries.typescript.cjs'"
check "SKILL.md no nombra lenguajes ni herramientas concretas" bash -c "! grep -qiE '\\b(rust|nest|php|ruby|spring|django|fastapi|golang|kotlin|python|typescript|javascript)\\b|node\\.js|\\bnpm\\b|dependency-cruiser|depcruise|import-linter|archunit|c#' '${lag}/SKILL.md'"
check "ningún fichero versionado cita check-boundaries.sh ni boundaries.typescript.cjs" bash -c "! git -C '${package}' grep -l -E 'check-boundaries\\.sh|boundaries\\.typescript\\.cjs' -- ':!tests/scripts.test.sh'"
check "la guía condensada define las mismas reglas y etiquetas que la skill" node -e '
  const fs = require("fs");
  const path = require("path");
  const dir = process.argv[1];
  const re = /\*\*(R-[A-Z]{3}-\d{2}) \((INV|DEF|CONV)\)\*\*/g;
  const collect = (files) => {
    const found = new Map();
    const repeated = [];
    for (const file of files) {
      for (const [, id, tag] of fs.readFileSync(file, "utf8").matchAll(re)) {
        if (found.has(id)) repeated.push(id);
        else found.set(id, tag);
      }
    }
    return { found, repeated };
  };
  const refs = fs.readdirSync(path.join(dir, "references")).filter((f) => f.endsWith(".md")).sort().map((f) => path.join(dir, "references", f));
  const skill = collect([path.join(dir, "SKILL.md"), ...refs, path.join(dir, "assets", "ARCHITECTURE.template.md")]);
  const guide = collect([path.join(dir, "assets", "layered-architecture-guide.md")]);
  const problems = [];
  const count = (tag) => [...skill.found.values()].filter((t) => t === tag).length;
  if (count("INV") !== 39 || count("DEF") !== 26 || count("CONV") !== 25) problems.push(`cuentas ${count("INV")}/${count("DEF")}/${count("CONV")} (esperado 39/26/25)`);
  if (skill.repeated.length) problems.push(`definidas dos veces en la skill: ${skill.repeated.join(", ")}`);
  if (guide.repeated.length) problems.push(`definidas dos veces en la guía: ${guide.repeated.join(", ")}`);
  for (const [id, tag] of skill.found) if (guide.found.get(id) !== tag) problems.push(`${id}: skill ${tag}, guía ${guide.found.get(id) ?? "ausente"}`);
  for (const id of guide.found.keys()) if (!skill.found.has(id)) problems.push(`${id}: solo en la guía`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
' "$lag"
check "la guía condensada repite el texto de las reglas de references" node -e '
  const fs = require("fs");
  const path = require("path");
  const dir = process.argv[1];
  const norm = (s) => s.replace(/\*\*|`|—/g, "").replace(/\s+/g, " ").trim();
  const ruleLines = (file) => fs.readFileSync(file, "utf8").split("\n").filter((l) => /^- \*\*R-[A-Z]{3}-\d{2} \((?:INV|DEF|CONV)\)\*\*/.test(l)).map(norm);
  const refDir = path.join(dir, "references");
  const refLines = fs.readdirSync(refDir).filter((f) => f.endsWith(".md")).sort().flatMap((f) => ruleLines(path.join(refDir, f)).map((l) => [f, l]));
  const guide = new Set(ruleLines(path.join(dir, "assets", "layered-architecture-guide.md")));
  const diff = refLines.filter(([, l]) => !guide.has(l));
  if (diff.length) {
    console.error(diff.map(([f, l]) => `${f}: ${l.slice(0, 70)}…`).join("\n"));
    process.exit(1);
  }
' "$lag"
check "la plantilla contempla varias partes" grep -qF 'varias partes' "$tpl"
cd_agent="${package}/.apm/agents/concept-developer.agent.md"
check "concept-developer elige intensidad por módulo" bash -c 'grep -qF "Elige la intensidad de cada módulo según «Intensidad y variante» de layered-architecture-guideline: ligera si es un CRUD sin reglas de negocio, completa en cuanto hay una; si no está claro y no puedes preguntar, ligera y anotada." "$1" && grep -qF "Lo que no puedas decidir (framework, cómo se entregan los errores de dominio) queda como \`Por decidir\` y va a «Huecos»." "$1" && ! grep -qF "(intensidad, framework" "$1"' _ "$cd_agent"
check "SKILL.md paso 2 imita forma y hueco sin intensidad" bash -c 'grep -qF "imita la forma de los vecinos, no sus incumplimientos" "$1" && grep -qF "Hueco: framework o fronteras." "$1" && ! grep -qF "Hueco: intensidad" "$1" && test "$(wc -w < "$1")" -le 1500' _ "${lag}/SKILL.md"
check "plantilla anota intensidad por módulo" bash -c 'grep -qF "Una línea por módulo, ligera o completa según «Intensidad y variante»." "$1" && grep -qF "\`<módulo>\`: ligera | completa" "$1" && ! grep -qF "Intensidad: Por decidir" "$1"' _ "$tpl"
check "R-AGT-03 imita forma no incumplimientos" bash -c 'grep -qE "^\- \*\*R-AGT-03 \(DEF\)\*\*.*Imita la forma, no los incumplimientos de reglas que tengan\." "$1" && test "$(grep -cE "^\- \*\*R-AGT-03 " "$1")" -eq 1' _ "${lag}/assets/layered-architecture-guide.md"
check "grep intensidad sin hueco ni Por decidir" bash -c 'hits=$(git -C "$1" grep -n -i "intensidad" -- .apm) && test -n "$hits" && ! git -C "$1" grep -n -i -E "Intensidad:[[:space:]]*Por decidir|\(intensidad,[[:space:]]*framework|Hueco:[[:space:]]*intensidad" -- .apm' _ "$package"

echo
if [[ $failures -eq 0 ]]; then
  echo "Todo bien."
else
  echo "${failures} comprobaciones fallidas."
  exit 1
fi
