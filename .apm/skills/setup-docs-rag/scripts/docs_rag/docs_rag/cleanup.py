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


def rst_to_md(text: str) -> str:
    """reStructuredText de Sphinx a Markdown: docutils lee el documento y `rst.py` escribe el árbol.

    Si docutils no puede con el fichero o no queda nada, la página conserva el texto de origen."""
    from .rst import convert

    source = text.replace("\r\n", "\n")
    try:
        markdown = convert(source)
    except Exception:
        markdown = ""
    return clean_md(markdown if markdown.strip() else source)


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
