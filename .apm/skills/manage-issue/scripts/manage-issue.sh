#!/usr/bin/env bash
# Crea la issue con la etiqueta del tipo y asignada al usuario autenticado.
# Antes comprueba el título con check-title.sh: si no pasa, no crea nada.
# Sale con 1 si el título, el cuerpo o el tipo no valen, o si gh o GitLab fallan.
# Sale con 3 si falta el token del .env.
# En GitLab la crea gitlab.mjs.

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

if [[ $# -ne 3 || -z "$1" || -z "$2" || -z "$3" ]]; then
  echo "Uso: manage-issue.sh TITULO CUERPO TIPO" >&2
  exit 1
fi

title=$1
body=$2
type=$3

bash "${here}/check-title.sh" "$title" >/dev/null || exit 1

if [[ ! -f "$body" || ! -r "$body" ]]; then
  echo "El fichero del cuerpo debe existir y ser legible." >&2
  exit 1
fi

# Sin Node: dice si el repositorio es de GitLab, por GIT_WORKFLOW_FORGE (entorno o .env) o por origin.
looks_like_gitlab() {
  local declared=${GIT_WORKFLOW_FORGE:-} top common file line
  if [[ -z "$declared" ]] && top=$(git rev-parse --show-toplevel 2>/dev/null); then
    file="${top}/.env"
    if [[ ! -f "$file" ]]; then
      common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=""
      file="$(dirname "$common")/.env"
    fi
    if [[ -f "$file" ]]; then
      line=$(grep -E '^[[:space:]]*(export[[:space:]]+)?GIT_WORKFLOW_FORGE[[:space:]]*=' "$file" | tail -n 1) || line=""
      declared=$(sed -E "s/^[^=]*=//; s/[[:space:]]+#.*$//; s/[\"'[:space:]]//g" <<<"$line")
    fi
  fi
  if [[ -n "$declared" ]]; then
    grep -qix 'gitlab' <<<"$declared"
    return
  fi
  # El host tiene que ser gitlab.com, no un nombre que lo contenga ni una ruta.
  git remote get-url origin 2>/dev/null | grep -qiE '^([a-z+]+://)?([^/@]*@)?(altssh\.)?gitlab\.com[:/]'
}

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  : # Fuera de un repositorio no hay forge que consultar: responde gh.sh, con su código 3.
elif command -v node >/dev/null 2>&1; then
  forge=$(node "${here}/gitlab.mjs" forge) || exit $?
  case "$forge" in
    github) ;;
    gitlab) exec node "${here}/gitlab.mjs" issue create "$title" "$body" "$type" ;;
    *)
      echo "No se pudo saber si el forge es GitHub o GitLab." >&2
      exit 1
      ;;
  esac
elif looks_like_gitlab; then
  echo "Node no está instalado. Hace falta Node 24 o superior para GitLab." >&2
  exit 1
fi

label_args=()
if bash "${here}/ensure-label.sh" "$type"; then
  label_args=(--label "$type")
else
  status=$?
  [[ $status -eq 2 ]] || exit "$status"
fi

bash "${here}/gh.sh" issue create --title "$title" --body-file "$body" --assignee "@me" "${label_args[@]+"${label_args[@]}"}"
