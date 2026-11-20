#!/usr/bin/env bash
# Prueba update-apm-dependency.sh con manifiestos aislados en directorios temporales.
# Uso: bash tests/update-apm-dependency.test.sh

set -uo pipefail

package=$(cd "$(dirname "$0")/.." && pwd)
script="${package}/.github/scripts/update-apm-dependency.sh"
workflow="${package}/.github/workflows/update-apm-dependency.yml"
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

run_script() {
  local directory=$1
  shift
  (cd "$directory" && bash "$script" "$@" >/dev/null 2>&1)
}

assert_rejected_without_changes() {
  local name=$1
  local directory=$2
  shift 2
  if run_script "$directory" "$@"; then
    echo "FALLA ${name}: el script aceptó la entrada"
    failures=$((failures + 1))
  elif cmp -s "${directory}/before.yml" "${directory}/apm.yml"; then
    echo "ok    ${name}"
  else
    echo "FALLA ${name}: apm.yml cambió pese al rechazo"
    failures=$((failures + 1))
  fi
}

valid="${work}/valid"
mkdir -p "$valid"
cat >"${valid}/apm.yml" <<'YAML'
name: consumer
dependencies:
  apm:
    - owner/selected#v1.0.0 # selected dependency
    - owner/unrelated#v3.2.1
    - another/repository#main
YAML
cp "${valid}/apm.yml" "${valid}/before.yml"
cat >"${valid}/expected.yml" <<'YAML'
name: consumer
dependencies:
  apm:
    - owner/selected#v2.4.0 # selected dependency
    - owner/unrelated#v3.2.1
    - another/repository#main
YAML

valid_update() {
  run_script "$valid" owner/selected v2.4.0 &&
    cmp -s "${valid}/expected.yml" "${valid}/apm.yml"
}
check "actualiza la dependencia seleccionada y conserva las demás" valid_update

cp "${valid}/before.yml" "${valid}/apm.yml"
cp "${valid}/apm.yml" "${valid}/before.yml"
assert_rejected_without_changes "rechaza un repositorio inválido sin escritura parcial" \
  "$valid" 'owner/selected;touch /tmp/apm-test' v2.4.0
assert_rejected_without_changes "rechaza una referencia inválida sin escritura parcial" \
  "$valid" owner/selected 'v2.4.0 invalid'

absent="${work}/absent"
mkdir -p "$absent"
cat >"${absent}/apm.yml" <<'YAML'
dependencies:
  apm:
    - owner/unrelated#v3.2.1
YAML
cp "${absent}/apm.yml" "${absent}/before.yml"
assert_rejected_without_changes "rechaza una dependencia ausente sin escritura parcial" \
  "$absent" owner/selected v2.4.0

ambiguous="${work}/ambiguous"
mkdir -p "$ambiguous"
cat >"${ambiguous}/apm.yml" <<'YAML'
dependencies:
  apm:
    - owner/selected#v1.0.0
    - owner/selected#v1.1.0
    - owner/unrelated#v3.2.1
YAML
cp "${ambiguous}/apm.yml" "${ambiguous}/before.yml"
assert_rejected_without_changes "rechaza coincidencias múltiples sin escritura parcial" \
  "$ambiguous" owner/selected v2.4.0

no_manifest="${work}/no-manifest"
mkdir -p "$no_manifest"
if run_script "$no_manifest" owner/selected v2.4.0; then
  echo "FALLA rechaza la ausencia de apm.yml"
  failures=$((failures + 1))
elif test ! -e "${no_manifest}/apm.yml"; then
  echo "ok    rechaza la ausencia de apm.yml"
else
  echo "FALLA creó apm.yml pese a que no existía"
  failures=$((failures + 1))
fi

check "el workflow reusable no invoca scripts internos del paquete" \
  bash -c '! grep -Eq "\.github/scripts/|scripts/(release|update-apm)" "$1"' _ "$workflow"
check "el workflow usa base_branch como base de la PR" \
  grep -Fq 'base: ${{ inputs.base_branch }}' "$workflow"

if (( failures > 0 )); then
  echo "${failures} comprobación(es) fallaron."
  exit 1
fi

echo "Todas las comprobaciones pasaron."
