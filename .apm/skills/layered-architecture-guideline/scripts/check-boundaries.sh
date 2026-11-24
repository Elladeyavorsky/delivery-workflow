#!/usr/bin/env bash
# Comprueba las fronteras de capas de un proyecto con dependency-cruiser.
# Uso: check-boundaries.sh [RUTA_DEL_PROYECTO]. Sin ruta, el directorio actual.
# Sale con 0 si no hay violaciones, con 1 si las hay y con 2 si no se pudo comprobar.

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
skill_dir=$(cd "${here}/.." && pwd)

fail2() {
  echo "$1" >&2
  exit 2
}

if ! command -v node >/dev/null 2>&1; then
  fail2 "Falta Node. Instala Node 20 o superior."
fi
node_version=$(node -p 'process.versions.node')
if (( ${node_version%%.*} < 20 )); then
  fail2 "Node ${node_version}. Hace falta Node 20 o superior."
fi

project=${1:-.}
if [[ ! -d "$project" ]]; then
  fail2 "No existe el directorio ${project}."
fi
project=$(cd "$project" && pwd)

architecture="${project}/docs/ARCHITECTURE.md"
if [[ ! -f "$architecture" ]]; then
  fail2 "No existe ${architecture}."
fi

extract_json=$(mktemp)
roots_file=$(mktemp)
trap 'rm -f "$extract_json" "$roots_file" "${cruise_json:-}" "${cruise_err:-}"' EXIT

node - "$architecture" "$extract_json" "$roots_file" <<'NODE'
const fs = require("fs");
const md = fs.readFileSync(process.argv[2], "utf8");
const match = md.match(/```json[ \t]+boundaries[ \t]*\r?\n([\s\S]*?)\r?\n```/);
if (!match) {
  console.error("En docs/ARCHITECTURE.md falta el bloque json boundaries.");
  process.exit(2);
}
let config;
try {
  config = JSON.parse(match[1]);
} catch {
  console.error("El bloque json boundaries de docs/ARCHITECTURE.md no es JSON válido.");
  process.exit(2);
}
const layers = config.layers || {};
const required = ["presentation", "application", "domain", "infrastructure"];
const empty = [];
for (const name of required) {
  const list = Array.isArray(layers[name]) ? layers[name] : [];
  const filled = list.filter((item) => String(item).trim() !== "");
  if (filled.length === 0) empty.push(name);
}
if (empty.length > 0) {
  const which = empty.join(", ");
  console.error(
    `La capa ${which} queda vacía en el bloque json boundaries. Rellena layers.${empty.join(", layers.")}.`
  );
  process.exit(2);
}
const roots = new Set();
for (const list of Object.values(layers)) {
  if (!Array.isArray(list)) continue;
  for (const item of list) {
    const stripped = String(item).replace(/^\^/, "").replace(/^\.\//, "");
    const first = stripped.split("/")[0];
    if (first && !/[.*+?^${}()|[\]\\]/.test(first)) roots.add(first);
  }
}
fs.writeFileSync(process.argv[3], match[1]);
fs.writeFileSync(process.argv[4], [...roots].join("\n"));
NODE

if [[ ! -f "${project}/package.json" ]]; then
  fail2 "No hay configuración de fronteras para este stack. Añade package.json y TypeScript (tsconfig.json o la dependencia typescript)."
fi

cd "$project"
is_typescript=no
if [[ -f tsconfig.json ]]; then
  is_typescript=yes
elif node -e '
  const p = require("./package.json");
  const deps = Object.assign({}, p.dependencies, p.devDependencies, p.peerDependencies);
  process.exit(deps.typescript ? 0 : 1);
'; then
  is_typescript=yes
fi
if [[ "$is_typescript" != yes ]]; then
  fail2 "No hay configuración de fronteras para este stack. Falta tsconfig.json o la dependencia typescript."
fi

config_file="${skill_dir}/assets/boundaries.typescript.cjs"
if [[ ! -f "$config_file" ]]; then
  fail2 "No hay configuración de fronteras para TypeScript. Falta ${config_file}."
fi

if [[ -n "${DEPCRUISE_BIN:-}" ]]; then
  bin=$DEPCRUISE_BIN
else
  bin="${project}/node_modules/.bin/depcruise"
fi
if [[ ! -x "$bin" && ! -f "$bin" ]]; then
  fail2 "Falta dependency-cruiser. Instálalo con npm install --save-dev dependency-cruiser."
fi

export BOUNDARIES_CONFIG
BOUNDARIES_CONFIG=$(cat "$extract_json")

globs=()
if [[ -s "$roots_file" ]]; then
  while IFS= read -r root || [[ -n "$root" ]]; do
    [[ -z "$root" ]] && continue
    if [[ -d "${project}/${root}" ]]; then
      globs+=("${root}/**/*.ts" "${root}/**/*.tsx")
    fi
  done <"$roots_file"
  if (( ${#globs[@]} == 0 )); then
    fail2 "La herramienta analizó 0 ficheros. Comprueba el glob **/*.ts y **/*.tsx."
  fi
else
  globs=("**/*.ts" "**/*.tsx")
fi

cruise_args=(--config "$config_file" -T json --exclude "(^|/)(node_modules|dist|build|coverage|\.git)/")
if [[ -f "${project}/tsconfig.json" ]]; then
  cruise_args+=(--ts-config tsconfig.json)
fi

cruise_json=$(mktemp)
cruise_err=$(mktemp)
set +e
"$bin" "${cruise_args[@]}" "${globs[@]}" >"$cruise_json" 2>"$cruise_err"
set -e

if [[ ! -s "$cruise_json" ]]; then
  reason=$(tr '\n' ' ' <"$cruise_err")
  fail2 "La herramienta no devolvió JSON. ${reason}"
fi

node - "$cruise_json" <<'NODE'
const fs = require("fs");
let data;
try {
  data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
} catch {
  console.error("La herramienta no devolvió un JSON válido.");
  process.exit(2);
}
const total = (data.summary && data.summary.totalCruised) || 0;
if (total === 0) {
  console.error("La herramienta analizó 0 ficheros. Comprueba el glob **/*.ts y **/*.tsx.");
  process.exit(2);
}
const violations = ((data.summary && data.summary.violations) || []).filter(
  (item) => item.rule && item.rule.severity === "error"
);
const unresolved = [];
for (const mod of data.modules || []) {
  for (const dep of mod.dependencies || []) {
    if (dep.couldNotResolve && typeof dep.module === "string" && dep.module.startsWith(".")) {
      unresolved.push(`${mod.source} → ${dep.module}`);
    }
  }
}
if (violations.length > 0) {
  for (const item of violations) {
    const id = item.rule.name;
    console.log(`${item.from}: ${id} (importa ${item.to})`);
  }
  process.exit(1);
}
if (unresolved.length > 0) {
  const shown = unresolved.slice(0, 5).join(", ");
  console.error(`Hay imports locales sin resolver: ${shown}. La comprobación no es fiable.`);
  process.exit(2);
}
console.log(`Fronteras OK: ${total} ficheros analizados`);
NODE
