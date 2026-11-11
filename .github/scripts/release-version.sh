#!/usr/bin/env bash
# Escribe la versión de apm.yml si se puede publicar: X.Y.Z, sin etiqueta y mayor que la última.
# La usa el workflow de release en cada pull request a main y en cada push a main.

set -euo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "No es un repositorio git." >&2
  exit 1
}
cd "$root"

# Solo la primera línea version:, con comillas dobles, simples o sin comillas.
line=$(grep -m 1 -E '^version:' apm.yml) || line=""
version=""
pattern='^version:[[:space:]]*("([0-9]+\.[0-9]+\.[0-9]+)"|'"'"'([0-9]+\.[0-9]+\.[0-9]+)'"'"'|([0-9]+\.[0-9]+\.[0-9]+))[[:space:]]*$'
if [[ "$line" =~ $pattern ]]; then
  version=${BASH_REMATCH[2]}${BASH_REMATCH[3]}${BASH_REMATCH[4]}
fi
if [[ -z "$version" ]]; then
  echo "apm.yml no tiene una línea version: \"X.Y.Z\"." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/v${version}" >/dev/null; then
  echo "La etiqueta v${version} ya existe. Sube version en apm.yml con un commit chore: release X.Y.Z." >&2
  exit 1
fi

# Solo etiquetas vX.Y.Z exactas: una v0.2.0-rc1 no cuenta como versión publicada.
latest=$(git tag -l 'v*' | { grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true; } | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
if [[ -n "$latest" && "$(printf '%s\n%s\n' "$latest" "$version" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)" != "$version" ]]; then
  echo "La versión ${version} es menor que la última etiqueta, v${latest}." >&2
  exit 1
fi

echo "$version"
