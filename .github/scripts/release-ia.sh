#!/usr/bin/env bash
# Calcula de forma determinista la siguiente versión desde la última etiqueta estable.
# Conserva el nombre histórico del script; no consulta servicios de IA.

set -euo pipefail
export LC_ALL=C

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "No es un repositorio git." >&2
  exit 1
}
cd "$root"

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

ultima=""
while IFS= read -r tag; do
  [[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || continue
  version=${tag#v}
  if [[ -z "$ultima" ]] || version_gt "$version" "$ultima"; then
    ultima=$version
  fi
done < <(git tag -l 'v*')
printf '%s\n' "$ultima" >ia-ultima.txt

if [[ -n "$ultima" ]]; then
  rango="v${ultima}..HEAD"
else
  rango="HEAD"
fi

git log "$rango" --format='%s' |
  grep -v '^chore: release ' >ia-asuntos.txt || true
git log "$rango" --format='%s%n%b' >ia-cambios.txt

tipo=patch
motivo="No hay commits feat ni cambios incompatibles: corresponde patch."
if grep -qE '^[a-zA-Z0-9-]+(\([^)]*\))?!:' ia-asuntos.txt ||
  grep -q 'BREAKING CHANGE' ia-cambios.txt; then
  tipo=major
  motivo='Hay un ! o BREAKING CHANGE: corresponde major.'
elif grep -qE '^feat(\([^)]*\))?:' ia-asuntos.txt; then
  tipo=minor
  motivo='Hay al menos un commit feat y ningún cambio incompatible: corresponde minor.'
fi

printf '%s\n' "$tipo" >ia-tipo.txt
printf '%s\n' "las reglas de los commits" >ia-quien.txt
printf '%s\n' "$motivo" >ia-motivo.txt

IFS=. read -r mayor menor parche <<<"${ultima:-0.0.0}"
case "$tipo" in
  major) mayor=$((mayor + 1)); menor=0; parche=0 ;;
  minor) menor=$((menor + 1)); parche=0 ;;
  patch) parche=$((parche + 1)) ;;
esac
siguiente="${mayor}.${menor}.${parche}"
printf '%s\n' "$siguiente" >ia-version.txt

{
  novedades=$(grep -E '^feat(\([^)]*\))?!?:' ia-asuntos.txt |
    sed -E 's/^feat(\([^)]*\))?!?: */- /' || true)
  correcciones=$(grep -E '^fix(\([^)]*\))?!?:' ia-asuntos.txt |
    sed -E 's/^fix(\([^)]*\))?!?: */- /' || true)
  otros=$(grep -vE '^(feat|fix)(\([^)]*\))?!?:' ia-asuntos.txt |
    sed -E 's/^[a-zA-Z0-9-]+(\([^)]*\))?!?: */- /; t; s/^/- /' || true)
  [[ -n "$novedades" ]] && printf '### Novedades\n%s\n\n' "$novedades"
  [[ -n "$correcciones" ]] && printf '### Correcciones\n%s\n\n' "$correcciones"
  [[ -n "$otros" ]] && printf '### Otros cambios\n%s\n\n' "$otros"
} >ia-resumen.md

echo "Última versión: ${ultima:-ninguna} | reglas de commits: ${tipo} | siguiente: ${siguiente}"
echo "Motivo: ${motivo}"
