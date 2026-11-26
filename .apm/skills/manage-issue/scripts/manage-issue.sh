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

if command -v node >/dev/null 2>&1; then
  forge=$(node "${here}/gitlab.mjs" forge) || exit $?
  if [[ "$forge" == gitlab ]]; then
    exec node "${here}/gitlab.mjs" issue create "$title" "$body" "$type"
  fi
elif git remote get-url origin 2>/dev/null | grep -q 'gitlab\.com'; then
  echo "Node no está instalado. Hace falta Node 20 o superior para GitLab." >&2
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
