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

check "el workflow no es reutilizable ni acepta otro repositorio" \
  bash -c '! grep -Eq "workflow_call|inputs:" "$1"' _ "$workflow"
check "el workflow usa self-release.py y no el actualizador antiguo" \
  bash -c 'grep -Fq ".github/scripts/self-release.py" "$1" && ! grep -Eq "update-apm-dependency\.sh|scripts/release-" "$1"' _ "$workflow"
check "el job solo corre en venturars/delivery-workflow" \
  grep -Fq "if: github.repository == 'venturars/delivery-workflow'" "$workflow"
check "la pull request va a staging" \
  grep -Fq 'base: staging' "$workflow"
check "la pull request se abre en draft" \
  grep -Fq 'draft: true' "$workflow"
check "el checkout es staging" \
  grep -Fq 'ref: staging' "$workflow"
check "el instalador publica apm en el PATH de los pasos siguientes" \
  grep -Fq 'echo "$HOME/.local/bin" >> "$GITHUB_PATH"' "$workflow"
check "el horario es diario a las 08:17 UTC" \
  grep -Fq 'cron: "17 8 * * *"' "$workflow"
check "el instalador de APM usa el token de Actions" \
  grep -Fq 'GITHUB_TOKEN: ${{ github.token }}' "$workflow"

apm_update_commands=$(grep -E '^[[:space:]]*apm update ' "$workflow" | sed 's/^[[:space:]]*//')
target_loop=$(awk '
  /for TARGET in / { active=1 }
  active { sub(/^[[:space:]]+/, ""); print }
  active && /^done$/ { exit }
' "$workflow")
# Ejecuta el bucle real con un apm simulado y el apm.yml de release que se pida.
targets_updated() {
  local dir
  dir=$(mktemp -d)
  mkdir -p "$dir/apm_modules/venturars/delivery-workflow"
  echo "$1" >"$dir/apm_modules/venturars/delivery-workflow/apm.yml"
  (cd "$dir" && DEPENDENCY_REPO=venturars/delivery-workflow REF=v9.9.9 \
    bash -euo pipefail -c "apm() { echo \"\$4\" >>targets; }; $target_loop" >/dev/null && tr '\n' ' ' <targets)
  rm -rf "$dir"
}
check "una release que declara opencode actualiza los cuatro targets" \
  test "$(targets_updated 'targets: [opencode, claude, cursor, codex]')" = "claude opencode cursor codex "
check "una release sin opencode omite ese target y no falla" \
  test "$(targets_updated 'targets: [claude, cursor, codex]')" = "claude cursor codex "
check "el workflow actualiza cada target sin interacción" \
  bash -c 'test "$1" = '\''apm update "$DEPENDENCY_REPO" --target "$TARGET" --yes --force'\''' _ "$apm_update_commands"

selector=$(awk '
  /tag=\$\(jq -r / { active=1; next }
  active && /<<<"\$releases"\)/ { exit }
  active { sub(/^[[:space:]]+/, ""); print }
' "$workflow")

pagination_call=$(awk '
  /releases=\$\(gh api/ { active=1 }
  active { print }
  active && /\)/ { exit }
' "$workflow")
check "el workflow pagina y agrupa todas las páginas de GitHub Releases" \
  bash -c 'grep -Fq -- "--paginate" <<<"$1" &&
    grep -Fq -- "--slurp" <<<"$1" &&
    grep -Fq "releases?per_page=100" <<<"$1"' _ "$pagination_call"
check "el selector del workflow no consulta publishedAt" \
  bash -c '! grep -Eq "publishedAt|published_at" <<<"$1"' _ "$selector"

release_step="${work}/release-step.sh"
awk '
  /id: release/ { in_step=1 }
  in_step && /run: \|/ { in_run=1; next }
  in_run && /^          / { sub(/^          /, ""); print; next }
  in_run && /^[[:space:]]*$/ { print ""; next }
  in_run { exit }
' "$workflow" >"$release_step"
check "extrae el bloque run real del paso de selección del workflow" \
  test -s "$release_step"

releases_out_of_order="${work}/releases-out-of-order.json"
cat >"$releases_out_of_order" <<'JSON'
[
  {"tagName":"v0.7.0","isDraft":false,"isPrerelease":false,"publishedAt":"2026-01-10T00:00:00Z"},
  {"tagName":"v0.6.5","isDraft":false,"isPrerelease":false,"publishedAt":"2026-01-11T00:00:00Z"}
]
JSON

select_tag() {
  jq -r "$selector" "$1"
}
selects_as() {
  local expected=$1
  local fixture=$2
  [[ "$(select_tag "$fixture")" == "$expected" ]]
}
check "el selector real del workflow elige v0.7.0 aunque v0.6.5 se publique después" \
  selects_as v0.7.0 "$releases_out_of_order"

releases_semver="${work}/releases-semver.json"
cat >"$releases_semver" <<'JSON'
[
  {"tagName":"v1.9.9","isDraft":false,"isPrerelease":false},
  {"tagName":"v1.10.0","isDraft":false,"isPrerelease":false,"publishedAt":"2026-01-01T00:00:00Z"},
  {"tagName":"v99.0.0-rc.1","isDraft":false,"isPrerelease":true},
  {"tagName":"v98.0.0-rc.1","isDraft":false,"isPrerelease":false},
  {"tagName":"v01.0.0","isDraft":false,"isPrerelease":false},
  {"tagName":"v1.02.0","isDraft":false,"isPrerelease":false},
  {"tagName":"v1.10.00","isDraft":false,"isPrerelease":false},
  {"tagName":"not-a-version","isDraft":false,"isPrerelease":false}
]
JSON
check "el selector real compara SemVer numéricamente y descarta prereleases y tags inválidos" \
  selects_as v1.10.0 "$releases_semver"

releases_large_major="${work}/releases-large-major.json"
cat >"$releases_large_major" <<'JSON'
[
  {"tagName":"v9007199254740993.0.0","isDraft":false,"isPrerelease":false},
  {"tagName":"v9007199254740992.0.0","isDraft":false,"isPrerelease":false}
]
JSON
check "el selector real ordena componentes major mayores que 2^53 exactamente" \
  selects_as v9007199254740993.0.0 "$releases_large_major"

releases_large_minor="${work}/releases-large-minor.json"
cat >"$releases_large_minor" <<'JSON'
[
  {"tagName":"v1.9007199254740993.0","isDraft":false,"isPrerelease":false},
  {"tagName":"v1.9007199254740992.0","isDraft":false,"isPrerelease":false}
]
JSON
check "el selector real ordena componentes minor mayores que 2^53 exactamente" \
  selects_as v1.9007199254740993.0 "$releases_large_minor"

releases_large_patch="${work}/releases-large-patch.json"
cat >"$releases_large_patch" <<'JSON'
[
  {"tagName":"v1.0.9007199254740993","isDraft":false,"isPrerelease":false},
  {"tagName":"v1.0.9007199254740992","isDraft":false,"isPrerelease":false}
]
JSON
check "el selector real ordena componentes patch mayores que 2^53 exactamente" \
  selects_as v1.0.9007199254740993 "$releases_large_patch"

releases_large_digit_count="${work}/releases-large-digit-count.json"
cat >"$releases_large_digit_count" <<'JSON'
[
  {"tagName":"v10000000000000000.0.0","isDraft":false,"isPrerelease":false},
  {"tagName":"v9999999999999999.0.0","isDraft":false,"isPrerelease":false}
]
JSON
check "el selector real ordena exactamente componentes con distinta cantidad de dígitos" \
  selects_as v10000000000000000.0.0 "$releases_large_digit_count"

releases_invalid="${work}/releases-invalid.json"
cat >"$releases_invalid" <<'JSON'
[
  {"tagName":"v999.0.0-rc.1","isDraft":false,"isPrerelease":true},
  {"tagName":"v998.0.0-beta","isDraft":false,"isPrerelease":false},
  {"tagName":"v02.0.0","isDraft":false,"isPrerelease":false},
  {"tagName":"v1.02.0","isDraft":false,"isPrerelease":false},
  {"tagName":"v1.2.03","isDraft":false,"isPrerelease":false},
  {"tagName":"1.2.3","isDraft":false,"isPrerelease":false},
  {"tagName":"v1.2","isDraft":false,"isPrerelease":false},
  {"tagName":"v1.2.3+build.1","isDraft":false,"isPrerelease":false}
]
JSON
selects_empty() {
  [[ -z "$(select_tag "$1")" ]]
}
check "el selector real rechaza prereleases, ceros iniciales y tags fuera de vX.Y.Z" \
  selects_empty "$releases_invalid"

releases_paged="${work}/releases-paged.json"
jq -n '
  def release($tag; $draft; $prerelease; $published):
    {
      tag_name: $tag,
      draft: $draft,
      prerelease: $prerelease,
      published_at: $published
    };
  [
    range(0; 10) as $page
    | [
        range(0; 100) as $item
        | ($page * 100 + $item) as $patch
        | release("v1.0.\($patch)"; false; false; "2026-11-20T00:00:00Z")
      ]
  ] + [
    [
      release("v9007199254740993.0.0"; false; false; "2020-01-01T00:00:00Z"),
      release("v9007199254740992.0.0"; false; false; "2030-01-01T00:00:00Z"),
      release("v999999999999999999.0.0"; true; false; "2040-01-01T00:00:00Z"),
      release("v888888888888888888.0.0"; false; true; "2050-01-01T00:00:00Z"),
      release("v01.0.0"; false; false; "2060-01-01T00:00:00Z")
    ]
  ]
' >"$releases_paged"
has_multiple_pages_and_over_1000_releases() {
  jq -e '
    length == 11
    and ([.[0:10][] | length] | all(. == 100))
    and (.[10] | length <= 100)
    and ([.[0:10][][] | select(.draft == false and .prerelease == false)] | length == 1000)
  ' \
    "$releases_paged" >/dev/null
}
check "el fixture tiene 11 páginas, 1000 releases válidas en las primeras diez y máximo SemVer en la última" \
  has_multiple_pages_and_over_1000_releases
check "el selector aplana las páginas y elige el máximo global de la última" \
  selects_as v9007199254740993.0.0 "$releases_paged"

gh_mock_bin="${work}/gh-mock-bin"
mkdir -p "$gh_mock_bin"
cat >"${gh_mock_bin}/gh" <<'MOCK'
#!/usr/bin/env bash
set -u
printf '%s\n' "$@" >"$GH_ARGS_FILE"
if [[ $# -ne 4 ||
      "$1" != api ||
      "$2" != --paginate ||
      "$3" != --slurp ||
      "$4" != "repos/$DEPENDENCY_REPO/releases?per_page=100" ]]; then
  echo "gh recibió argumentos inesperados." >&2
  exit 64
fi
cat "$GH_RESPONSE_FILE"
MOCK
chmod +x "${gh_mock_bin}/gh"

gh_args="${work}/gh-arguments.txt"
gh_expected_args="${work}/gh-expected-arguments.txt"
printf '%s\n' \
  api \
  --paginate \
  --slurp \
  'repos/owner/selected/releases?per_page=100' >"$gh_expected_args"
workflow_output="${work}/github-output"
workflow_log="${work}/release-step.log"
run_real_release_step() {
  env \
    PATH="${gh_mock_bin}:$PATH" \
    GH_ARGS_FILE="$gh_args" \
    GH_RESPONSE_FILE="$releases_paged" \
    DEPENDENCY_REPO=owner/selected \
    GITHUB_OUTPUT="$workflow_output" \
    bash "$release_step" >"$workflow_log" 2>&1
}
check "el paso real del workflow se ejecuta con el gh simulado" run_real_release_step
check "el mock recibe api --paginate --slurp, el endpoint exacto y ningún límite" \
  cmp -s "$gh_expected_args" "$gh_args"
check "el paso real del workflow selecciona el máximo estable de la página 11" \
  grep -Fxq 'ref=v9007199254740993.0.0' "$workflow_output"

if (( failures > 0 )); then
  echo "${failures} comprobación(es) fallaron."
  exit 1
fi

echo "Todas las comprobaciones pasaron."
