#!/usr/bin/env bash
# Resume la rama, la rama base, el token de GitHub, gh, Node, el remoto y los cambios locales.

set -euo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "No es un repositorio git." >&2
  exit 1
}
cd "$root"

# Rama base: GIT_WORKFLOW_BASE, staging si existe en origin, o la rama por defecto de origin.
detect_base() {
  local head candidate
  if [[ -n "${GIT_WORKFLOW_BASE:-}" ]]; then
    if [[ ! "$GIT_WORKFLOW_BASE" =~ ^[A-Za-z0-9._/-]+$ ]]; then
      echo "GIT_WORKFLOW_BASE tiene que ser el nombre de una rama." >&2
      return 1
    fi
    echo "${GIT_WORKFLOW_BASE#origin/}"
    return
  fi
  if git show-ref --verify --quiet refs/remotes/origin/staging; then
    echo "staging"
    return
  fi
  if head=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); then
    echo "${head#origin/}"
    return
  fi
  for candidate in main master; do
    if git show-ref --verify --quiet "refs/remotes/origin/${candidate}"; then
      echo "$candidate"
      return
    fi
  done
  echo "No se pudo detectar la rama base. Defínela con GIT_WORKFLOW_BASE." >&2
  return 1
}

list_changes() {
  local changes=$1
  local status path rest label
  if [[ -z "$changes" ]]; then
    echo "  (ninguno)"
    return
  fi
  while IFS=$'\t' read -r status path rest; do
    case "$status" in
      M) label="modificado" ;;
      A) label="nuevo" ;;
      D) label="borrado" ;;
      T) label="tipo cambiado" ;;
      U) label="sin fusionar" ;;
      R*) label="renombrado" ;;
      C*) label="copiado" ;;
      *) label="$status" ;;
    esac
    if [[ -n "$rest" ]]; then
      echo "  ${label}  ${path} -> ${rest}"
    else
      echo "  ${label}  ${path}"
    fi
  done <<<"$changes"
}

branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || git rev-parse --short HEAD)

echo "Repositorio: ${root}"
echo "Rama: ${branch}"

if base=$(detect_base 2>/dev/null); then
  echo "Rama base: ${base}"
else
  echo "Rama base: no detectada. Defínela con GIT_WORKFLOW_BASE."
fi

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  echo "Token de GitHub: GITHUB_TOKEN definido"
else
  echo "Token de GitHub: falta. Define GITHUB_TOKEN y reinicia tu editor o agente."
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI: no instalado. Hace falta para la pull request, las etiquetas y la spec."
elif gh auth status --hostname "${GH_HOST:-github.com}" >/dev/null 2>&1; then
  echo "GitHub CLI: con sesión"
else
  echo "GitHub CLI: sin sesión. Ejecuta gh auth login."
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node: no instalado. Hace falta Node 20 o superior."
else
  node_version=$(node -p 'process.versions.node')
  if (( ${node_version%%.*} >= 20 )); then
    echo "Node: ${node_version}"
  else
    echo "Node: ${node_version}. Hace falta Node 20 o superior."
  fi
fi

if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
  counts=$(git rev-list --left-right --count "HEAD...${upstream}")
  ahead=${counts%%[[:space:]]*}
  behind=${counts##*[[:space:]]}
  echo "Remoto: ${upstream} (${ahead} por subir, ${behind} por bajar)"
else
  echo "Remoto: esta rama no sigue a ninguna"
fi

if git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "Último commit: $(git log -1 --pretty=format:'%h %s')"
else
  echo "Último commit: todavía no hay commits"
fi

echo
echo "Preparados para el commit:"
list_changes "$(git diff --cached --name-status)"

echo "Modificados y sin preparar:"
list_changes "$(git diff --name-status)"

echo "Sin seguimiento:"
untracked=$(git ls-files --others --exclude-standard)
if [[ -z "$untracked" ]]; then
  echo "  (ninguno)"
else
  while IFS= read -r path; do
    echo "  ${path}"
  done <<<"$untracked"
fi
