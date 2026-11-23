"""Limpieza de la documentación: todo acaba en Markdown sin navegación, repeticiones ni páginas que no son de referencia."""

from __future__ import annotations

import re
from collections import Counter
from pathlib import PurePosixPath

# Páginas que no son de referencia: índices, búsqueda, avisos legales, guías de contribución, historiales.
_NOT_REFERENCE = re.compile(
    r"(?ix)(?:^|/)(?:genindex|search|py-modindex|modindex|copyright|license|licence|bugs|about|contents|download|"
    r"changelog|changes|history|news|release-notes|contributing|code[_-]of[_-]conduct|security|authors|"
    r"funding|support|governance|maintainers|sponsors)(?:[._-][^/]*)?\.(?:md|mdx|rst|html?)$"
)
_SKIPPED_DIRS = re.compile(r"(?i)(?:^|/)(?:_sources|_static|_images|\.github|node_modules|blog|i18n|translations|locale|__tests__|test|tests|fixtures|examples?/.+/node_modules)/")


def is_reference(source: str) -> bool:
    return not (_NOT_REFERENCE.search(source) or _SKIPPED_DIRS.search(source))


# --- HTML (Sphinx, MkDocs y otros sitios generados) ---

_HTML_TO_REMOVE = [
    "script", "style", "nav", "header", "footer", "noscript", "form",
    "div.sphinxsidebar", "div.related", "div.footer", "[role=navigation]", "[role=search]",
    "a.headerlink", "div.md-sidebar", "div.md-header", "div.md-footer", ".toctree-wrapper", "div.highlight-default > .copybutton",
]


def html_to_md(html: str) -> str:
    """Contenido principal de una página HTML en Markdown (ATX y bloques de código con vallas)."""
    from bs4 import BeautifulSoup
    from markdownify import markdownify

    soup = BeautifulSoup(html, "html.parser")
    for selector in _HTML_TO_REMOVE:
        for element in soup.select(selector):
            element.decompose()
    primary = soup.select_one("[role=main]") or soup.select_one("main") or soup.select_one("article") or soup.select_one("div.body") or soup.body or soup
    md = markdownify(str(primary), heading_style="ATX", bullets="-", code_language_callback=_pre_language)
    return clean_md(md)


def _pre_language(element) -> str:
    class_names = " ".join(element.get("class", []) + (element.parent.get("class", []) if element.parent else []))
    m = re.search(r"(?:highlight-|language-)(\w+)", class_names)
    return m.group(1) if m and m.group(1) not in ("default", "none", "text") else ""


def clean_md(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("¶", "").replace(" ", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


# --- MDX ---

_MDX_IMPORT = re.compile(r"^(?:import|export)\s.+$", re.M)


def mdx_to_md(text: str) -> str:
    """Quita los import/export de MDX y el frontmatter; el resto ya es Markdown."""
    text = re.sub(r"\A---\n.*?\n---\n", "", text.replace("\r\n", "\n"), flags=re.S)
    return clean_md(_MDX_IMPORT.sub("", text))


# --- reStructuredText (docs de Sphinx en el repositorio) ---

_UNDERLINE = re.compile(r"^([=\-~^\"'`#*+<>:._])\1*\s*$")
_DIRECTIVE = re.compile(r"^(\s*)\.\.\s+([\w:-]+)::\s*(.*)$")
_ROLE = re.compile(r":[\w:-]+:`~?([^`<]+?)(?:\s*<[^>]+>)?`")
_DEFINITIONS = {"function", "class", "method", "attribute", "data", "exception", "decorator", "classmethod", "staticmethod", "property",
                 "py:function", "py:class", "py:method", "py:attribute", "py:data", "py:exception", "autofunction", "autoclass", "automethod"}
_VERSION_DIRECTIVES = {"versionadded": "Added in version", "versionchanged": "Changed in version", "deprecated": "Deprecated since version"}


def rst_to_md(text: str) -> str:
    """Conversión ligera de reStructuredText a Markdown: títulos, código, definiciones y avisos de versión."""
    lines = text.replace("\r\n", "\n").split("\n")
    levels: list[str] = []
    output: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        following = lines[i + 1] if i + 1 < len(lines) else ""
        # Título con sobrerrayado: ===\nTítulo\n===
        if len(line.strip()) >= 3 and _UNDERLINE.match(line) and i + 2 < len(lines) and _UNDERLINE.match(lines[i + 2]) and lines[i + 1].strip():
            marker = "o" + line[0]
            if marker not in levels:
                levels.append(marker)
            output.append("#" * min(levels.index(marker) + 1, 6) + " " + lines[i + 1].strip())
            i += 3
            continue
        # Título subrayado: Título\n=====
        if line.strip() and _UNDERLINE.match(following) and len(following.strip()) >= min(len(line.strip()), 3) and not line.startswith(" "):
            marker = following[0]
            if marker not in levels:
                levels.append(marker)
            output.append("#" * min(levels.index(marker) + 1, 6) + " " + _ROLE.sub(r"`\1`", line.strip()))
            i += 2
            continue
        d = _DIRECTIVE.match(line)
        if d:
            indentation, name, argument = d.groups()
            if output and output[-1].strip():
                output.append("")
            page_body, i = _indented_block(lines, i + 1, len(indentation))
            if name in ("code-block", "code", "sourcecode", "literalinclude"):
                output += [f"```{argument.strip() if name != 'literalinclude' else ''}", *_strip_options(page_body), "```"]
            elif name in _VERSION_DIRECTIVES:
                version, _, rest = argument.partition(" ")
                body_text = " ".join(l.strip() for l in _strip_options(page_body) if l.strip())
                output.append(f"{_VERSION_DIRECTIVES[name]} {version}: {(rest + ' ' + body_text).strip()}".rstrip(": "))
            elif name in _DEFINITIONS or name.startswith("py:"):
                output.append(f"`{argument.strip()}`")
                clean_body = [l for l in _strip_options(page_body)]
                first = True
                for l in clean_body:
                    if first and l.strip():
                        output.append(":   " + _ROLE.sub(r"`\1`", l.strip()))
                        first = False
                    else:
                        output.append("    " + _ROLE.sub(r"`\1`", l.strip()) if l.strip() else "")
                if first:
                    output.append(":   ")
            elif name in ("note", "warning", "tip", "important", "caution", "attention", "danger", "seealso", "admonition"):
                output.append(f"> **{name.capitalize()}:** {argument}".rstrip())
                output += ["> " + _ROLE.sub(r"`\1`", l.strip()) for l in _strip_options(page_body) if l.strip()]
            elif name == "module" or name == "py:module" or name == "currentmodule":
                output.append(f"Module: `{argument.strip()}`")
            elif name in ("toctree", "image", "figure", "include", "only", "contents", "raw", "highlight", "index", "autosummary"):
                pass
            else:
                output += [_ROLE.sub(r"`\1`", l) for l in page_body]
            output.append("")
            continue
        # Bloque literal: párrafo que acaba en «::» seguido de texto sangrado.
        if line.rstrip().endswith("::") and not line.strip().startswith(".."):
            output.append(_ROLE.sub(r"`\1`", line.rstrip()[:-1]).rstrip())
            page_body, j = _indented_block(lines, i + 1, len(line) - len(line.lstrip()))
            if any(l.strip() for l in page_body):
                output += ["", "```", *_strip_options(page_body), "```", ""]
                i = j
                continue
            i += 1
            continue
        output.append(_ROLE.sub(r"`\1`", line).replace("``", "`"))
        i += 1
    return clean_md("\n".join(output))


def _indented_block(lines: list[str], start: int, base_indentation: int) -> tuple[list[str], int]:
    page_body: list[str] = []
    i = start
    while i < len(lines):
        l = lines[i]
        if l.strip() and (len(l) - len(l.lstrip())) <= base_indentation:
            break
        page_body.append(l)
        i += 1
    while page_body and not page_body[-1].strip():
        page_body.pop()
    return _dedent(page_body), i


def _dedent(lines: list[str]) -> list[str]:
    indentations = [len(l) - len(l.lstrip()) for l in lines if l.strip()]
    to_remove = min(indentations) if indentations else 0
    return [l[to_remove:] if l.strip() else "" for l in lines]


def _strip_options(lines: list[str]) -> list[str]:
    """Quita las opciones de directiva (:linenos:, :caption: …) del principio del cuerpo."""
    result = list(lines)
    while result and re.match(r"^\s*:[\w-]+:", result[0]):
        result.pop(0)
    while result and not result[0].strip():
        result.pop(0)
    return result


# --- Repeticiones entre páginas (navegación que se cuela, pies, banners) ---


def remove_repeated(files: dict[str, str], threshold: float = 0.5, min_files: int = 5) -> dict[str, str]:
    """Quita las líneas que aparecen en más de `umbral` de los ficheros (fuera de bloques de código)."""
    if len(files) < min_files:
        return files
    occurrences: Counter[str] = Counter()
    for text in files.values():
        occurrences.update({l.strip() for l in _lines_outside_code(text) if len(l.strip()) > 3 and not l.lstrip().startswith("#")})
    repeated = {l for l, n in occurrences.items() if n / len(files) > threshold}
    if not repeated:
        return files
    result = {}
    for source, text in files.items():
        in_code = False
        new_items = []
        for l in text.split("\n"):
            if l.lstrip().startswith(("```", "~~~")):
                in_code = not in_code
            if not in_code and l.strip() in repeated:
                continue
            new_items.append(l)
        result[source] = clean_md("\n".join(new_items))
    return result


def _lines_outside_code(text: str) -> list[str]:
    in_code = False
    outside = []
    for l in text.split("\n"):
        if l.lstrip().startswith(("```", "~~~")):
            in_code = not in_code
            continue
        if not in_code:
            outside.append(l)
    return outside


def to_markdown(source: str, text: str) -> tuple[str, str]:
    """(fuente con .md, contenido en Markdown) según la extensión del fichero."""
    file_path = PurePosixPath(source)
    name_suffix = file_path.suffix.lower()
    if name_suffix in (".html", ".htm"):
        return str(file_path.with_suffix(".md")), html_to_md(text)
    if name_suffix == ".rst":
        return str(file_path.with_suffix(".md")), rst_to_md(text)
    if name_suffix == ".mdx":
        return str(file_path.with_suffix(".md")), mdx_to_md(text)
    return source, clean_md(text)
