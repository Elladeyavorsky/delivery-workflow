#!/usr/bin/env bash
# Comprueba apm audit --ci con las fuentes locales y artefactos recién generados.
# Uso: bash tests/apm-audit.test.sh

set -euo pipefail

package=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/delivery-workflow-apm-audit.XXXXXX")
trap 'rm -rf "$work"' EXIT

# No copiar despliegues locales ni estado Git/APM: se generan en work.
tar -C "$package" \
  --exclude='./.git' \
  --exclude='./.env' \
  --exclude='./.agents' \
  --exclude='./.claude' \
  --exclude='./.codex' \
  --exclude='./.cursor' \
  --exclude='./.opencode' \
  --exclude='./.apm-local' \
  --exclude='./.mcp.json' \
  --exclude='./opencode.json' \
  --exclude='./apm.lock.yaml' \
  --exclude='./apm_modules' \
  -cf - . | tar -C "$work" -xf -

for path in .agents .claude .codex .cursor .opencode apm_modules apm.lock.yaml; do
  if [[ -e "${work}/${path}" ]]; then
    echo "FALLA: se copió el artefacto preexistente ${path}"
    exit 1
  fi
done

# La prueba integra las fuentes APM locales; omite dependencias externas para
# que el replay compare el resultado regenerado con esta implementación.
ruby -ryaml -e '
  path = ARGV.fetch(0)
  manifest = YAML.load_file(path)
  manifest.delete("dependencies")
  File.write(path, YAML.dump(manifest))
' "${work}/apm.yml"

echo "Generando artefactos APM temporales desde las fuentes locales..."
(cd "$work" && apm install --only apm --no-audit)

for path in .agents .claude .codex .cursor .opencode apm_modules apm.lock.yaml; do
  if [[ ! -e "${work}/${path}" ]]; then
    echo "FALLA: apm install no generó ${path}"
    exit 1
  fi
done

echo "Ejecutando apm audit --ci en la copia temporal..."
(cd "$work" && apm audit --ci)

echo "La auditoría se ejecutó en una copia temporal regenerada desde las fuentes del paquete."
