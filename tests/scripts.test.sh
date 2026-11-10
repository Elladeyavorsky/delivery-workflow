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
case "$1 $2" in
  "label list") [[ -n "${FAKE_GH_LABELS:-}" ]] && echo "$FAKE_GH_LABELS"; exit 0 ;;
  "label create") [[ "${FAKE_GH_LABEL_DENIED:-}" == 1 ]] && exit 1; exit 0 ;;
  "pr list") exit 0 ;;
  "pr create") echo "https://github.com/owner/repo/pull/9"; exit 0 ;;
  "api user") printf 'HTTP/2.0 200 OK\netag: "u"\n\n{"login":"ada"}\n'; exit 0 ;;
  "api repos/owner/repo/collaborators?per_page=100&page=1") printf 'HTTP/2.0 200 OK\netag: "c"\n\n[{"login":"ada"}]\n'; exit 0 ;;
esac
exit 0
GH
chmod +x "${work}/bin/gh"
export PATH="${work}/bin:${PATH}"
export FAKE_GH_LOG="${work}/gh.log"
unset GIT_WORKFLOW_BASE

git init -q --bare -b main "${work}/origin.git"
git clone -q "${work}/origin.git" "${work}/repo" 2>/dev/null
cd "${work}/repo"
git config user.email test@example.com
git config user.name Test
git commit -q --allow-empty -m init
git push -q origin HEAD:main HEAD:staging
git fetch -q origin

# create-branch: siete tipos, knowledge incluido; los demás se rechazan.
check "create-branch acepta knowledge" "${skills}/create-branch/scripts/create-branch.sh" 5 knowledge add-notes
check "la rama sale de staging sin seguirla" test -z "$(git config branch.5-knowledge-add-notes.merge)"
check "create-branch rechaza un tipo mal escrito" bash -c "! '${skills}/create-branch/scripts/create-branch.sh' 6 feta x 2>/dev/null"

# create-empty-commit: abre la rama y se niega en la rama base.
check "create-empty-commit en la rama de trabajo" "${skills}/create-empty-commit/scripts/create-empty-commit.sh" 5
check "el commit vacío es chore: open #5" test "$(git log -1 --format=%s)" = "chore: open #5"
git switch -q -c staging origin/staging 2>/dev/null
check "create-empty-commit se niega en staging" bash -c "! '${skills}/create-empty-commit/scripts/create-empty-commit.sh' 5 2>/dev/null"
git switch -q 5-knowledge-add-notes

# ensure-label: existe, se crea, o no hay permiso (2), o el tipo no vale (1).
label="${skills}/create-issue/scripts/ensure-label.sh"
FAKE_GH_LABELS=feat check "ensure-label con la etiqueta ya creada" "$label" feat
check "ensure-label crea la que falta" "$label" knowledge
check "ensure-label creó knowledge" grep -q "label create knowledge" "$FAKE_GH_LOG"
FAKE_GH_LABELS=Knowledge FAKE_GH_LABEL_DENIED=1 check "ensure-label acepta la etiqueta con otras mayúsculas" "$label" knowledge
FAKE_GH_LABEL_DENIED=1 "$label" fix >/dev/null 2>&1
check "ensure-label sin permiso sale con 2" test $? -eq 2
"$label" feta >/dev/null 2>&1
check "ensure-label rechaza un tipo mal escrito" test $? -eq 1
check "ensure-label es igual en create-issue y create-pr-base" cmp -s "$label" "${skills}/create-pr-base/scripts/ensure-label.sh"

# create-pr-base: base detectada, draft, asignada y con etiqueta.
echo "cuerpo" >"${work}/body.md"
: >"$FAKE_GH_LOG"
check "create-pr-base abre la PR" "${skills}/create-pr-base/scripts/create-pr-base.sh" 5-knowledge-add-notes "Add notes" "${work}/body.md" knowledge
check "la PR va contra staging, en draft, asignada y con etiqueta" grep -q -- "pr create --base staging --head 5-knowledge-add-notes --title Add notes --body-file ${work}/body.md --draft --assignee @me --label knowledge" "$FAKE_GH_LOG"
: >"$FAKE_GH_LOG"
FAKE_GH_LABEL_DENIED=1 "${skills}/create-pr-base/scripts/create-pr-base.sh" 5-knowledge-add-notes "Add notes" "${work}/body.md" fix >/dev/null 2>&1
check "sin permiso de etiquetas, la PR sale sin etiqueta" bash -c "grep -q 'pr create' '$FAKE_GH_LOG' && ! grep -q -- '--label' <(grep 'pr create' '$FAKE_GH_LOG')"
GIT_WORKFLOW_BASE=main "${skills}/create-pr-base/scripts/create-pr-base.sh" 5-knowledge-add-notes "Add notes" "${work}/body.md" feat >/dev/null 2>&1
check "GIT_WORKFLOW_BASE cambia la base" grep -q -- "pr create --base main" "$FAKE_GH_LOG"

# github-cache: el fichero vive en .git/ y no aparece como cambio.
node "${skills}/github-cache/scripts/github-cache.mjs" directory owner/repo >/dev/null
check "la caché se guarda en .git/" test -f .git/.git-workflow-cache.json
check "la caché no se guarda en la raíz" test ! -e .git-workflow-cache.json
check "git no ve la caché" test -z "$(git status --porcelain)"

# check-status: informa de gh y de Node.
status=$("${skills}/check-status/scripts/check-status.sh")
check "check-status informa de gh" grep -q "^GitHub CLI:" <<<"$status"
check "check-status informa de Node" grep -q "^Node:" <<<"$status"

# Las skills lanzan sus scripts con bash o node: así una regla de permisos vale para todos.
commands=$(grep -rhoE '`[^`]*<carpeta de esta skill>/scripts/[^`]*`' "${skills}")
check "las skills nombran sus scripts" test -n "$commands"
check "las skills lanzan sus scripts con bash o node" bash -c '! grep -vE "^\`(bash|node) " <<<"$1"' _ "$commands"

echo
if [[ $failures -eq 0 ]]; then
  echo "Todo bien."
else
  echo "${failures} comprobaciones fallidas."
  exit 1
fi
