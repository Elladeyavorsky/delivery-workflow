#!/usr/bin/env bash
# Actualiza exactamente una dependencia APM fijada como repo#ref.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Uso: $0 ORGANIZACION/REPOSITORIO REF" >&2
  exit 2
fi

repo=$1
ref=$2

[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "Repositorio no válido." >&2
  exit 2
}
[[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ &&
  "$ref" != *..* && "$ref" != *//* && "$ref" != */ &&
  "$ref" != *. && "$ref" != *@\{* ]] &&
  git check-ref-format --allow-onelevel "$ref" >/dev/null 2>&1 || {
  echo "Referencia no válida." >&2
  exit 2
}
[[ -f apm.yml ]] || {
  echo "No existe apm.yml en el directorio actual." >&2
  exit 1
}

python3 - "$repo" "$ref" <<'PY'
from pathlib import Path
import os
import re
import stat
import sys
import tempfile

repo, ref = sys.argv[1:]
path = Path("apm.yml")
original = path.read_bytes()
lines = original.decode("utf-8").splitlines(keepends=True)

key_re = re.compile(r"^(?P<indent>[ \t]*)(?P<key>[A-Za-z0-9_-]+):[ \t]*(?:#.*)?(?:\r?\n)?$")
dependency_re = re.compile(
    r"^(?P<prefix>[ \t]*-[ \t]*)(?P<quote>['\"]?)"
    r"(?P<value>[^'\"\s]+)(?P=quote)(?P<suffix>[ \t]*(?:#.*)?)(?P<newline>\r?\n?)$"
)

dependencies = None
for index, line in enumerate(lines):
    match = key_re.match(line)
    if match and match.group("key") == "dependencies":
        dependencies = (index, len(match.group("indent")))
        break
if dependencies is None:
    raise SystemExit("apm.yml no contiene dependencies.")

dependencies_index, dependencies_indent = dependencies
apm_index = None
apm_indent = None
for index in range(dependencies_index + 1, len(lines)):
    line = lines[index]
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    match = key_re.match(line)
    indent = len(line) - len(line.lstrip(" \t"))
    if indent <= dependencies_indent:
        break
    if match and match.group("key") == "apm":
        apm_index = index
        apm_indent = len(match.group("indent"))
        break
if apm_index is None:
    raise SystemExit("apm.yml no contiene dependencies.apm.")

matches = []
for index in range(apm_index + 1, len(lines)):
    line = lines[index]
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    indent = len(line) - len(line.lstrip(" \t"))
    if indent <= apm_indent:
        break
    match = dependency_re.match(line)
    if not match:
        continue
    value = match.group("value")
    if value == repo or value.startswith(repo + "#"):
        matches.append((index, match, value))

if len(matches) != 1:
    reason = "no se encontró" if not matches else "hay más de una coincidencia"
    raise SystemExit(f"apm.yml: {reason} para {repo} en dependencies.apm.")

index, match, value = matches[0]
if not value.startswith(repo + "#") or not value[len(repo) + 1 :]:
    raise SystemExit(f"apm.yml: la dependencia {repo} no contiene un ref.")

line = lines[index]
updated_line = (
    line[: match.start("value")]
    + f"{repo}#{ref}"
    + line[match.end("value") :]
)
lines[index] = updated_line
updated = "".join(lines).encode("utf-8")
if updated == original:
    print(f"La dependencia ya apunta a {repo}#{ref}.")
    raise SystemExit(0)

mode = stat.S_IMODE(path.stat().st_mode)
fd, temporary = tempfile.mkstemp(prefix=".apm.yml.", dir=path.parent)
try:
    with os.fdopen(fd, "wb") as stream:
        stream.write(updated)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, mode)
    os.replace(temporary, path)
except BaseException:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    raise
PY

echo "Dependencia actualizada a ${repo}#${ref} en apm.yml."
