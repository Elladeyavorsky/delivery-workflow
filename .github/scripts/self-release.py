#!/usr/bin/env python3
"""Quita la autodependencia de apm.yml y elige una release que no la trae.

APM instala un solo commit por paquete. Una etiqueta cuyo apm.yml depende de
otra etiqueta de este repositorio no se puede instalar junto con esa otra.
"""

import argparse
import base64
import re
import subprocess
import sys
from pathlib import Path

KEY_RE = re.compile(
    r"^(?P<indent>[ \t]*)(?P<key>[A-Za-z0-9_-]+):[ \t]*(?:#.*)?(?:\r?\n)?$"
)
ITEM_RE = re.compile(
    r"^(?P<prefix>[ \t]*-[ \t]*)(?P<quote>['\"]?)"
    r"(?P<value>[^'\"\s]+)(?P=quote)(?P<suffix>[ \t]*(?:#.*)?)(?P<newline>\r?\n?)$"
)
REPO_RE = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
TAG_RE = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
TAGS = r"""
[
  .[]
  | if type == "array" then .[] else . end
  | select(
      (if has("draft") then .draft else .isDraft end) == false
      and (if has("prerelease") then .prerelease else .isPrerelease end) == false
    )
  | select(
      (if has("tag_name") then .tag_name else .tagName end)
      | test("^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$")
    )
]
| sort_by(
    (if has("tag_name") then .tag_name else .tagName end)
    | ltrimstr("v")
    | split(".")
    | map([length, .])
  )
| reverse
| .[]
| .tag_name // .tagName // empty
"""


def indent_of(line):
    return len(line) - len(line.lstrip(" \t"))


def locate(lines, repo):
    """Devuelve (índice de apm, índices de la autodependencia) o None si no hay bloque."""
    dependencies = None
    for index, line in enumerate(lines):
        match = KEY_RE.match(line)
        if match and match.group("key") == "dependencies":
            dependencies = (index, len(match.group("indent")))
            break
    if dependencies is None:
        return None
    dependencies_index, dependencies_indent = dependencies
    apm_index = None
    apm_indent = None
    for index in range(dependencies_index + 1, len(lines)):
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if indent_of(line) <= dependencies_indent:
            break
        match = KEY_RE.match(line)
        if match and match.group("key") == "apm":
            apm_index = index
            apm_indent = len(match.group("indent"))
            break
    if apm_index is None:
        return None
    items = []
    for index in range(apm_index + 1, len(lines)):
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if indent_of(line) <= apm_indent:
            break
        match = ITEM_RE.match(line)
        if not match:
            continue
        value = match.group("value")
        if value == repo or value.startswith(repo + "#"):
            items.append((index, value))
    return apm_index, apm_indent, items


def section_has_body(lines, apm_index, apm_indent):
    for index in range(apm_index + 1, len(lines)):
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        return indent_of(line) > apm_indent
    return False


def read_lines(path):
    file = Path(path)
    if not file.is_file():
        raise SystemExit(f"No existe {path}.")
    return file.read_bytes().decode("utf-8").splitlines(keepends=True)


def write_lines(path, lines):
    Path(path).write_bytes("".join(lines).encode("utf-8"))


def self_pin(lines, repo):
    found = locate(lines, repo)
    if found is None or not found[2]:
        return None
    if len(found[2]) != 1:
        raise SystemExit(f"apm.yml tiene más de una entrada para {repo}.")
    return found[2][0][1]


def line_ending(lines):
    for line in lines:
        if line.endswith("\r\n"):
            return "\r\n"
        if line.endswith("\n"):
            return "\n"
    return "\n"


def prefix_of(line):
    return line[: indent_of(line)]


def first_content(lines, start, parent_indent):
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if indent_of(line) <= parent_indent:
            return index, None
        return index, prefix_of(line)
    return len(lines), None


def synthesized_prefix(parent_line, parent_indent):
    parent_prefix = parent_line[:parent_indent]
    if parent_prefix and set(parent_prefix) == {"\t"}:
        return parent_prefix + "\t"
    return parent_prefix + "  "


def replace_item_value(line, value):
    match = ITEM_RE.match(line)
    if not match:
        raise SystemExit("apm.yml: la entrada de la dependencia no es un elemento de lista.")
    return line[: match.start("value")] + value + line[match.end("value") :]


def find_dependencies(lines):
    for index, line in enumerate(lines):
        match = KEY_RE.match(line)
        if match and match.group("key") == "dependencies":
            return index, len(match.group("indent"))
    return None


def set_pin(lines, repo, ref):
    """Escribe repo#ref en dependencies.apm. Crea la clave si el release la quitó."""
    dependencies = find_dependencies(lines)
    if dependencies is None:
        raise SystemExit("apm.yml no contiene dependencies.")
    dependencies_index, dependencies_indent = dependencies
    found = locate(lines, repo)
    ending = line_ending(lines)
    desired = f"{repo}#{ref}"
    if found is None:
        insert_at, sibling = first_content(lines, dependencies_index, dependencies_indent)
        key_prefix = sibling
        if key_prefix is None:
            key_prefix = synthesized_prefix(lines[dependencies_index], dependencies_indent)
        block = [
            f"{key_prefix}apm:{ending}",
            f"{key_prefix}  - {desired}{ending}",
        ]
        return lines[:insert_at] + block + lines[insert_at:], "inserted"
    apm_index, _apm_indent, items = found
    if len(items) > 1:
        raise SystemExit(f"apm.yml tiene más de una entrada para {repo}.")
    if len(items) == 1:
        index, value = items[0]
        if value == desired:
            return lines, "unchanged"
        updated = lines.copy()
        updated[index] = replace_item_value(lines[index], desired)
        return updated, "updated"
    key_prefix = prefix_of(lines[apm_index])
    item = f"{key_prefix}  - {desired}{ending}"
    return lines[: apm_index + 1] + [item] + lines[apm_index + 1 :], "inserted"


def strip_self(lines, repo):
    found = locate(lines, repo)
    if found is None or not found[2]:
        return lines, "absent"
    apm_index, apm_indent, items = found
    if len(items) != 1:
        raise SystemExit(f"apm.yml tiene más de una entrada para {repo}.")
    item_index = items[0][0]
    updated = lines[:item_index] + lines[item_index + 1:]
    if not section_has_body(updated, apm_index, apm_indent):
        updated = updated[:apm_index] + updated[apm_index + 1:]
    return updated, "changed"


def manifest_text(repo, tag, manifests):
    if manifests is not None:
        path = Path(manifests) / f"{tag}.yml"
        if not path.is_file():
            raise SystemExit(f"No se puede leer el apm.yml de {tag}.")
        return path.read_text(encoding="utf-8")
    result = subprocess.run(
        ["gh", "api", f"repos/{repo}/contents/apm.yml?ref={tag}", "--jq", ".content"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode or 1)
    try:
        return base64.b64decode(result.stdout).decode("utf-8")
    except (ValueError, UnicodeDecodeError) as error:
        raise SystemExit(f"El apm.yml de {tag} no es base64 válido.") from error


def stable_tags(payload):
    result = subprocess.run(
        ["jq", "-r", TAGS],
        input=payload,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode or 1)
    return [tag for tag in result.stdout.splitlines() if tag]


def require_repo(repo):
    if not REPO_RE.fullmatch(repo):
        raise SystemExit("El repositorio tiene que ser organizacion/nombre.")


def command_pin(args):
    require_repo(args.repo)
    pin = self_pin(read_lines(args.file), args.repo)
    if pin:
        print(pin)


def command_align(args):
    require_repo(args.repo)
    lines = read_lines(args.file)
    updated, state = strip_self(lines, args.repo)
    if state == "changed" and not args.check:
        write_lines(args.file, updated)
    print(state)


def command_set(args):
    require_repo(args.repo)
    if not TAG_RE.fullmatch(args.ref):
        raise SystemExit("La release no tiene un tag vX.Y.Z válido.")
    lines = read_lines(args.file)
    updated, state = set_pin(lines, args.repo, args.ref)
    if state != "unchanged":
        write_lines(args.file, updated)
    print(state)


def command_select(args):
    require_repo(args.repo)
    payload = sys.stdin.read()
    chosen = ""
    for tag in stable_tags(payload):
        text = manifest_text(args.repo, tag, args.manifests)
        pin = self_pin(text.splitlines(keepends=True), args.repo)
        if pin is None:
            chosen = tag
            break
        print(f"Se omite {tag}: apm.yml depende de {pin}.", file=sys.stderr)
    if chosen:
        print(chosen)


def command_latest(args):
    payload = sys.stdin.read()
    tags = stable_tags(payload)
    if not tags:
        raise SystemExit(
            "No hay ninguna GitHub Release estable válida con tag vX.Y.Z."
        )
    print(tags[0])


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    pin = sub.add_parser("pin")
    pin.add_argument("repo")
    pin.add_argument("--file", default="apm.yml")
    pin.set_defaults(func=command_pin)

    align = sub.add_parser("align")
    align.add_argument("repo")
    align.add_argument("--file", default="apm.yml")
    align.add_argument("--check", action="store_true")
    align.set_defaults(func=command_align)

    setter = sub.add_parser("set")
    setter.add_argument("repo")
    setter.add_argument("ref")
    setter.add_argument("--file", default="apm.yml")
    setter.set_defaults(func=command_set)

    select = sub.add_parser("select")
    select.add_argument("repo")
    select.add_argument("--manifests")
    select.set_defaults(func=command_select)

    latest = sub.add_parser("latest")
    latest.set_defaults(func=command_latest)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
