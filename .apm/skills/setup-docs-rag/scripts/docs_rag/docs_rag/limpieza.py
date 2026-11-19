"""Limpieza de la documentación: todo acaba en Markdown sin navegación, repeticiones ni páginas que no son de referencia."""

from __future__ import annotations

import re
from collections import Counter
from pathlib import PurePosixPath

# Páginas que no son de referencia: índices, búsqueda, avisos legales, guías de contribución, historiales.
_NO_REFERENCIA = re.compile(
    r"(?ix)(?:^|/)(?:genindex|search|py-modindex|modindex|copyright|license|licence|bugs|about|contents|download|"
    r"changelog|changes|history|news|release-notes|contributing|code[_-]of[_-]conduct|security|authors|"
    r"funding|support|governance|maintainers|sponsors)(?:[._-][^/]*)?\.(?:md|mdx|rst|html?)$"
)
_CARPETAS_FUERA = re.compile(r"(?i)(?:^|/)(?:_sources|_static|_images|\.github|node_modules|blog|i18n|translations|locale|__tests__|test|tests|fixtures|examples?/.+/node_modules)/")


def es_referencia(fuente: str) -> bool:
    return not (_NO_REFERENCIA.search(fuente) or _CARPETAS_FUERA.search(fuente))


# --- HTML (Sphinx, MkDocs y otros sitios generados) ---

_QUITAR_HTML = [
    "script", "style", "nav", "header", "footer", "noscript", "form",
    "div.sphinxsidebar", "div.related", "div.footer", "[role=navigation]", "[role=search]",
    "a.headerlink", "div.md-sidebar", "div.md-header", "div.md-footer", ".toctree-wrapper", "div.highlight-default > .copybutton",
]


def html_a_md(html: str) -> str:
    """Contenido principal de una página HTML en Markdown (ATX y bloques de código con vallas)."""
    from bs4 import BeautifulSoup
    from markdownify import markdownify

    sopa = BeautifulSoup(html, "html.parser")
    for selector in _QUITAR_HTML:
        for nodo in sopa.select(selector):
            nodo.decompose()
    principal = sopa.select_one("[role=main]") or sopa.select_one("main") or sopa.select_one("article") or sopa.select_one("div.body") or sopa.body or sopa
    md = markdownify(str(principal), heading_style="ATX", bullets="-", code_language_callback=_lenguaje_pre)
    return limpiar_md(md)


def _lenguaje_pre(nodo) -> str:
    clases = " ".join(nodo.get("class", []) + (nodo.parent.get("class", []) if nodo.parent else []))
    m = re.search(r"(?:highlight-|language-)(\w+)", clases)
    return m.group(1) if m and m.group(1) not in ("default", "none", "text") else ""


def limpiar_md(texto: str) -> str:
    texto = texto.replace("\r\n", "\n").replace("¶", "").replace(" ", " ")
    texto = re.sub(r"[ \t]+\n", "\n", texto)
    texto = re.sub(r"\n{3,}", "\n\n", texto)
    return texto.strip() + "\n"


# --- MDX ---

_MDX_IMPORT = re.compile(r"^(?:import|export)\s.+$", re.M)


def mdx_a_md(texto: str) -> str:
    """Quita los import/export de MDX y el frontmatter; el resto ya es Markdown."""
    texto = re.sub(r"\A---\n.*?\n---\n", "", texto.replace("\r\n", "\n"), flags=re.S)
    return limpiar_md(_MDX_IMPORT.sub("", texto))


# --- reStructuredText (docs de Sphinx en el repositorio) ---

_SUBRAYADO = re.compile(r"^([=\-~^\"'`#*+<>:._])\1*\s*$")
_DIRECTIVA = re.compile(r"^(\s*)\.\.\s+([\w:-]+)::\s*(.*)$")
_ROL = re.compile(r":[\w:-]+:`~?([^`<]+?)(?:\s*<[^>]+>)?`")
_DEFINICIONES = {"function", "class", "method", "attribute", "data", "exception", "decorator", "classmethod", "staticmethod", "property",
                 "py:function", "py:class", "py:method", "py:attribute", "py:data", "py:exception", "autofunction", "autoclass", "automethod"}
_VERSIONES = {"versionadded": "Added in version", "versionchanged": "Changed in version", "deprecated": "Deprecated since version"}


def rst_a_md(texto: str) -> str:
    """Conversión ligera de reStructuredText a Markdown: títulos, código, definiciones y avisos de versión."""
    lineas = texto.replace("\r\n", "\n").split("\n")
    niveles: list[str] = []
    salida: list[str] = []
    i = 0
    while i < len(lineas):
        linea = lineas[i]
        siguiente = lineas[i + 1] if i + 1 < len(lineas) else ""
        # Título con sobrerrayado: ===\nTítulo\n===
        if len(linea.strip()) >= 3 and _SUBRAYADO.match(linea) and i + 2 < len(lineas) and _SUBRAYADO.match(lineas[i + 2]) and lineas[i + 1].strip():
            marca = "o" + linea[0]
            if marca not in niveles:
                niveles.append(marca)
            salida.append("#" * min(niveles.index(marca) + 1, 6) + " " + lineas[i + 1].strip())
            i += 3
            continue
        # Título subrayado: Título\n=====
        if linea.strip() and _SUBRAYADO.match(siguiente) and len(siguiente.strip()) >= min(len(linea.strip()), 3) and not linea.startswith(" "):
            marca = siguiente[0]
            if marca not in niveles:
                niveles.append(marca)
            salida.append("#" * min(niveles.index(marca) + 1, 6) + " " + _ROL.sub(r"`\1`", linea.strip()))
            i += 2
            continue
        d = _DIRECTIVA.match(linea)
        if d:
            sangria, nombre, argumento = d.groups()
            if salida and salida[-1].strip():
                salida.append("")
            cuerpo, i = _bloque_sangrado(lineas, i + 1, len(sangria))
            if nombre in ("code-block", "code", "sourcecode", "literalinclude"):
                salida += [f"```{argumento.strip() if nombre != 'literalinclude' else ''}", *_quitar_opciones(cuerpo), "```"]
            elif nombre in _VERSIONES:
                version, _, resto = argumento.partition(" ")
                texto_cuerpo = " ".join(l.strip() for l in _quitar_opciones(cuerpo) if l.strip())
                salida.append(f"{_VERSIONES[nombre]} {version}: {(resto + ' ' + texto_cuerpo).strip()}".rstrip(": "))
            elif nombre in _DEFINICIONES or nombre.startswith("py:"):
                salida.append(f"`{argumento.strip()}`")
                cuerpo_limpio = [l for l in _quitar_opciones(cuerpo)]
                primero = True
                for l in cuerpo_limpio:
                    if primero and l.strip():
                        salida.append(":   " + _ROL.sub(r"`\1`", l.strip()))
                        primero = False
                    else:
                        salida.append("    " + _ROL.sub(r"`\1`", l.strip()) if l.strip() else "")
                if primero:
                    salida.append(":   ")
            elif nombre in ("note", "warning", "tip", "important", "caution", "attention", "danger", "seealso", "admonition"):
                salida.append(f"> **{nombre.capitalize()}:** {argumento}".rstrip())
                salida += ["> " + _ROL.sub(r"`\1`", l.strip()) for l in _quitar_opciones(cuerpo) if l.strip()]
            elif nombre == "module" or nombre == "py:module" or nombre == "currentmodule":
                salida.append(f"Module: `{argumento.strip()}`")
            elif nombre in ("toctree", "image", "figure", "include", "only", "contents", "raw", "highlight", "index", "autosummary"):
                pass
            else:
                salida += [_ROL.sub(r"`\1`", l) for l in cuerpo]
            salida.append("")
            continue
        # Bloque literal: párrafo que acaba en «::» seguido de texto sangrado.
        if linea.rstrip().endswith("::") and not linea.strip().startswith(".."):
            salida.append(_ROL.sub(r"`\1`", linea.rstrip()[:-1]).rstrip())
            cuerpo, j = _bloque_sangrado(lineas, i + 1, len(linea) - len(linea.lstrip()))
            if any(l.strip() for l in cuerpo):
                salida += ["", "```", *_quitar_opciones(cuerpo), "```", ""]
                i = j
                continue
            i += 1
            continue
        salida.append(_ROL.sub(r"`\1`", linea).replace("``", "`"))
        i += 1
    return limpiar_md("\n".join(salida))


def _bloque_sangrado(lineas: list[str], inicio: int, sangria_base: int) -> tuple[list[str], int]:
    cuerpo: list[str] = []
    i = inicio
    while i < len(lineas):
        l = lineas[i]
        if l.strip() and (len(l) - len(l.lstrip())) <= sangria_base:
            break
        cuerpo.append(l)
        i += 1
    while cuerpo and not cuerpo[-1].strip():
        cuerpo.pop()
    return _dedent(cuerpo), i


def _dedent(lineas: list[str]) -> list[str]:
    sangrias = [len(l) - len(l.lstrip()) for l in lineas if l.strip()]
    quitar = min(sangrias) if sangrias else 0
    return [l[quitar:] if l.strip() else "" for l in lineas]


def _quitar_opciones(lineas: list[str]) -> list[str]:
    """Quita las opciones de directiva (:linenos:, :caption: …) del principio del cuerpo."""
    resultado = list(lineas)
    while resultado and re.match(r"^\s*:[\w-]+:", resultado[0]):
        resultado.pop(0)
    while resultado and not resultado[0].strip():
        resultado.pop(0)
    return resultado


# --- Repeticiones entre páginas (navegación que se cuela, pies, banners) ---


def quitar_repetidas(ficheros: dict[str, str], umbral: float = 0.5, minimo_ficheros: int = 5) -> dict[str, str]:
    """Quita las líneas que aparecen en más de `umbral` de los ficheros (fuera de bloques de código)."""
    if len(ficheros) < minimo_ficheros:
        return ficheros
    cuenta: Counter[str] = Counter()
    for texto in ficheros.values():
        cuenta.update({l.strip() for l in _lineas_fuera_de_codigo(texto) if len(l.strip()) > 3 and not l.lstrip().startswith("#")})
    repetidas = {l for l, n in cuenta.items() if n / len(ficheros) > umbral}
    if not repetidas:
        return ficheros
    resultado = {}
    for fuente, texto in ficheros.items():
        en_codigo = False
        nuevas = []
        for l in texto.split("\n"):
            if l.lstrip().startswith(("```", "~~~")):
                en_codigo = not en_codigo
            if not en_codigo and l.strip() in repetidas:
                continue
            nuevas.append(l)
        resultado[fuente] = limpiar_md("\n".join(nuevas))
    return resultado


def _lineas_fuera_de_codigo(texto: str) -> list[str]:
    en_codigo = False
    fuera = []
    for l in texto.split("\n"):
        if l.lstrip().startswith(("```", "~~~")):
            en_codigo = not en_codigo
            continue
        if not en_codigo:
            fuera.append(l)
    return fuera


def a_markdown(fuente: str, texto: str) -> tuple[str, str]:
    """(fuente con .md, contenido en Markdown) según la extensión del fichero."""
    ruta = PurePosixPath(fuente)
    sufijo = ruta.suffix.lower()
    if sufijo in (".html", ".htm"):
        return str(ruta.with_suffix(".md")), html_a_md(texto)
    if sufijo == ".rst":
        return str(ruta.with_suffix(".md")), rst_a_md(texto)
    if sufijo == ".mdx":
        return str(ruta.with_suffix(".md")), mdx_a_md(texto)
    return fuente, limpiar_md(texto)
