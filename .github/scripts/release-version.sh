#!/usr/bin/env bash
# Escribe la versión de apm.yml si se puede publicar: X.Y.Z, sin etiqueta y mayor que la última.
# La usa el workflow de release en cada pull request a main y en cada push a main.

set -euo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "No es un repositorio git." >&2
  exit 1
}
cd "$root"

version=$(sed -nE 's/^version:[[:space:]]*"?([0-9]+\.[0-9]+\.[0-9]+)"?[[:space:]]*$/\1/p' apm.yml)
if [[ -z "$version" ]]; then
  echo "apm.yml no tiene una línea version: \"X.Y.Z\"." >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/v${version}" >/dev/null; then
  echo "La etiqueta v${version} ya existe. Sube version en apm.yml con un commit chore: release X.Y.Z." >&2
  exit 1
fi

latest=$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
if [[ -n "$latest" && "$(printf '%s\n%s\n' "$latest" "$version" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)" != "$version" ]]; then
  echo "La versión ${version} es menor que la última etiqueta, v${latest}." >&2
  exit 1
fi

echo "$version"
