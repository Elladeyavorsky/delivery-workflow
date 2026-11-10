#!/usr/bin/env bash
# Deja lista la etiqueta del tipo en el repositorio de origin. La crea si falta.
# GitHub no distingue mayúsculas en las etiquetas: «Knowledge» ya vale para knowledge.
# Sale con 2 si la cuenta no puede crearla: la issue o la PR siguen sin etiqueta.
# Sale con 3 si falta el token del .env.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: ensure-label.sh TIPO" >&2
  exit 1
fi

type=$1

case "$type" in
  feat) color=a2eeef; description="Nueva funcionalidad" ;;
  fix) color=d73a4a; description="Corrige un fallo" ;;
  docs) color=0075ca; description="Documentación" ;;
  refactor) color=fbca04; description="Cambia el código sin cambiar el comportamiento" ;;
  test) color=0e8a16; description="Tests" ;;
  chore) color=cfd3d7; description="Mantenimiento" ;;
  knowledge) color=7057ff; description="Conocimiento del equipo" ;;
  *)
    echo "El tipo tiene que ser feat, fix, docs, refactor, test, chore o knowledge." >&2
    exit 1
    ;;
esac

source "$(dirname "${BASH_SOURCE[0]}")/gh.sh"
load_github_token || exit 3

if gh label list --search "$type" --limit 100 --json name --jq '.[].name' | grep -qix -- "$type"; then
  echo "Etiqueta ${type}: ya existe."
  exit 0
fi

if gh label create "$type" --color "$color" --description "$description" >/dev/null 2>&1; then
  echo "Etiqueta ${type}: creada."
  exit 0
fi

echo "Etiqueta ${type}: no se pudo crear con esta cuenta. Sigue sin etiqueta." >&2
exit 2
