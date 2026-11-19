#!/usr/bin/env bash
# Revisa un Dockerfile contra las reglas de docker-best-practices y escribe un aviso por línea.
# Uso: check-docker.sh [RUTA_AL_DOCKERFILE]. Sin ruta, ./Dockerfile.
# Sale con 0 si no hay avisos, con 1 si los hay y con 2 si falta el fichero.

set -euo pipefail

file=${1:-Dockerfile}
if [[ ! -f "$file" ]]; then
  echo "No existe ${file}." >&2
  exit 2
fi

warnings=0
warn() {
  echo "${file}:$1: $2"
  warnings=$((warnings + 1))
}

stages=" scratch "
last_user=""
line_no=0
start=0
instruction=""

check() {
  local at=$1 text=$2 keyword rest image tag
  keyword=$(awk '{print toupper($1)}' <<<"$text")
  rest=${text#* }

  case "$keyword" in
    FROM)
      image=$(awk '{for (i = 1; i <= NF; i++) if ($i !~ /^--/) { print $i; exit }}' <<<"$rest")
      if grep -qiE '[[:space:]]AS[[:space:]]+[^[:space:]]+' <<<"$rest"; then
        stages+="$(sed -E 's/.*[[:space:]][Aa][Ss][[:space:]]+([^[:space:]]+).*/\1/' <<<"$rest") "
      fi
      [[ "$stages" == *" ${image} "* ]] && return
      if [[ "$image" == *@sha256:* ]]; then
        return
      fi
      tag=""
      [[ "${image##*/}" == *:* ]] && tag=${image##*:}
      if [[ -z "$tag" || "$tag" == latest || ! "$tag" =~ ([0-9]+\.[0-9]+\.[0-9]+|[0-9]{8}) ]]; then
        warn "$at" "FROM ${image}: fija la versión exacta de la imagen (X.Y.Z, o la fecha en imágenes de sistema como debian:trixie-AAAAMMDD), o su @sha256."
      fi
      ;;
    USER)
      last_user=$(awk '{print $1}' <<<"$rest")
      ;;
    RUN)
      if grep -qE 'apt-get[[:space:]]+install' <<<"$rest"; then
        local packages
        packages=$(sed -E 's/.*apt-get[[:space:]]+install//; s/&&.*//; s/\|\|.*//; s/;.*//
          s/(--snapshot|--target-release|-t|-o)([[:space:]]+|=)[^[:space:]]+//g' <<<"$rest" \
          | tr ' ' '\n' | grep -vE '^(-|\$|"|$)' | grep -v '=' || true)
        if [[ -n "$packages" ]]; then
          warn "$at" "apt-get install sin versión fija: $(tr '\n' ' ' <<<"$packages")(usa paquete=versión)."
        fi
        grep -q -- '--no-install-recommends' <<<"$rest" \
          || warn "$at" "apt-get install sin --no-install-recommends."
        grep -qE 'apt-get[[:space:]]+update' <<<"$rest" \
          || warn "$at" "apt-get install sin apt-get update en el mismo RUN."
        grep -q -- '--snapshot' <<<"$rest" \
          || warn "$at" "apt-get sin --snapshot: las versiones fijadas desaparecen cuando Debian publica otras."
        grep -qE '/var/lib/apt/lists|target=/var/lib/apt' <<<"$rest" \
          || warn "$at" "apt-get sin rm -rf /var/lib/apt/lists/* en el mismo RUN."
      elif grep -qE 'apt-get[[:space:]]+update' <<<"$rest"; then
        warn "$at" "apt-get update sin apt-get install en el mismo RUN: su capa queda en caché con una lista vieja."
      fi
      if grep -qE '(curl|wget)[[:space:]]' <<<"$rest" && grep -qE '(curl|wget).*https?://' <<<"$rest" \
        && ! grep -qE 'sha(256|512)sum' <<<"$rest"; then
        warn "$at" "descarga con curl o wget sin comprobar su sha256sum en el mismo RUN."
      fi
      if grep -qE 'npm[[:space:]]+(install|i)[[:space:]].*(-g|--global)' <<<"$rest"; then
        local unpinned
        unpinned=$(sed -E 's/.*npm[[:space:]]+(install|i)//; s/&&.*//' <<<"$rest" | tr ' ' '\n' \
          | tr -d '"' | grep -vE '^(-|$)' | grep -vE '.@[0-9$]' || true)
        [[ -z "$unpinned" ]] || warn "$at" "npm install --global sin versión: $(tr '\n' ' ' <<<"$unpinned")(usa paquete@versión)."
      fi
      if grep -qE 'pip3?[[:space:]]+install' <<<"$rest"; then
        local loose
        loose=$(sed -E 's/.*pip3?[[:space:]]+install//; s/&&.*//' <<<"$rest" | tr ' ' '\n' \
          | tr -d '"' | grep -vE '^(-|$)' | grep -v '==' || true)
        [[ -z "$loose" ]] || warn "$at" "pip install sin versión: $(tr '\n' ' ' <<<"$loose")(usa paquete==versión)."
      fi
      ;;
  esac
}

while IFS= read -r line || [[ -n "$line" ]]; do
  line_no=$((line_no + 1))
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line//[[:space:]]/}" && -z "$instruction" ]] && continue
  if [[ -z "$instruction" ]]; then
    start=$line_no
  fi
  if [[ "$line" =~ \\[[:space:]]*$ ]]; then
    instruction+="${line%\\*} "
    continue
  fi
  instruction+="$line"
  check "$start" "$(tr -s '[:space:]' ' ' <<<"$instruction" | sed -E 's/^ //')"
  instruction=""
done <"$file"

if [[ -z "$last_user" || "$last_user" == root || "$last_user" == 0 || "$last_user" == 0:* ]]; then
  warn "$line_no" "la imagen termina con root: añade USER con un usuario sin privilegios."
fi

if [[ ! -f "$(dirname "$file")/.dockerignore" ]]; then
  warn 1 "no hay .dockerignore junto al Dockerfile: Docker envía toda la carpeta al construir."
fi

if [[ $warnings -eq 0 ]]; then
  echo "${file}: sin avisos."
  exit 0
fi
exit 1
