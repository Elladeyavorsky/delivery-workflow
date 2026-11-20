#!/usr/bin/env bash
# Escribe la versión de apm.yml si se puede publicar: X.Y.Z, sin etiqueta y mayor que la última.
# La usa el workflow de release en cada pull request a main y en cada push a main.

set -euo pipefail
export LC_ALL=C

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "No es un repositorio git." >&2
  exit 1
}
cd "$root"

# Solo la primera línea version:, con comillas dobles, simples o sin comillas.
line=$(grep -m 1 -E '^version:' apm.yml) || line=""
version=""
pattern='^version:[[:space:]]*("([0-9]+\.[0-9]+\.[0-9]+)"|'\''([0-9]+\.[0-9]+\.[0-9]+)'\''|([0-9]+\.[0-9]+\.[0-9]+))[[:space:]]*$'
if [[ "$line" =~ $pattern ]]; then
  version=${BASH_REMATCH[2]}${BASH_REMATCH[3]}${BASH_REMATCH[4]}
fi
if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "apm.yml no tiene una línea version: \"X.Y.Z\"." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/v${version}" >/dev/null; then
  echo "La etiqueta v${version} ya existe. Sube version en apm.yml con un commit chore: release X.Y.Z." >&2
  exit 1
fi

# Solo etiquetas estables vX.Y.Z exactas, sin ceros iniciales.
version_gt() {
  local left=$1 right=$2
  local -a left_parts right_parts
  local i a b
  IFS=. read -r -a left_parts <<<"$left"
  IFS=. read -r -a right_parts <<<"$right"
  for i in 0 1 2; do
    a=${left_parts[$i]}
    b=${right_parts[$i]}
    if ((${#a} > ${#b})); then
      return 0
    elif ((${#a} < ${#b})); then
      return 1
    elif [[ "$a" > "$b" ]]; then
      return 0
    elif [[ "$a" < "$b" ]]; then
      return 1
    fi
  done
  return 1
}

latest=""
while IFS= read -r tag; do
  [[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || continue
  candidate=${tag#v}
  if [[ -z "$latest" ]] || version_gt "$candidate" "$latest"; then
    latest=$candidate
  fi
done < <(git tag -l 'v*')

if [[ -n "$latest" ]] && ! version_gt "$version" "$latest"; then
  echo "La versión ${version} es menor que la última etiqueta, v${latest}." >&2
  exit 1
fi

echo "$version"
