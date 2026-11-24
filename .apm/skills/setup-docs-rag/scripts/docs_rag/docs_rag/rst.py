"""reStructuredText de Sphinx a Markdown: docutils construye el árbol y un recorrido propio lo escribe.

docutils no conoce las directivas de Sphinx. Antes de parsear se registran conservando argumento y
cuerpo, y el cuerpo se parsea como RST, así que las directivas anidadas, las tablas y las
sustituciones llegan resueltas al recorrido.
"""

from __future__ import annotations

import io
import re
import threading
from contextlib import contextmanager

from docutils import nodes, utils
from docutils.core import publish_doctree
from docutils.parsers.rst import Directive, directives, roles

# --- Directivas de Sphinx: un único lugar donde se listan ---

_VERSION_LABELS = {"versionadded": "Added in version", "versionchanged": "Changed in version", "deprecated": "Deprecated since version"}
_DEFINITIONS = ("function", "class", "method", "attribute", "data", "exception", "decorator", "classmethod", "staticmethod", "property")
_AUTO_DEFINITIONS = ("autofunction", "autoclass", "automethod")
_CODE = ("code-block", "code", "sourcecode")
_ADMONITIONS = ("note", "warning", "tip", "important", "caution", "attention", "danger", "seealso", "admonition")
_MODULES = ("module", "py:module", "currentmodule")
_IGNORED = ("toctree", "image", "figure", "include", "only", "contents", "raw", "highlight", "index", "autosummary", "literalinclude")
_NO_LANGUAGE = {"default", "none", "text"}


class sphinx_version(nodes.General, nodes.Element):
    """versionadded, versionchanged y deprecated: `label` y `version` van como atributos."""


class sphinx_definition(nodes.General, nodes.Element):
    """function, class, method…: la firma va en `signature`."""


class sphinx_admonition(nodes.General, nodes.Element):
    """note, warning, seealso, admonition…: el título va en `label`."""


class sphinx_module(nodes.General, nodes.Element):
    """module, py:module y currentmodule: el nombre va en `name`."""


class _AnyOptions(dict):
    """option_spec que acepta cualquier opción (:linenos:, :async:, :synopsis:…) y la deja en `options`."""

    def __missing__(self, key):
        return _keep


def _keep(value):
    return value


class _SphinxDirective(Directive):
    optional_arguments = 1
    final_argument_whitespace = True
    has_content = True
    option_spec = _AnyOptions({"class": _keep})

    def argument(self) -> str:
        return " ".join(" ".join(self.arguments).split())

    def parse_body(self, node: nodes.Element) -> nodes.Element:
        self.state.nested_parse(self.content, self.content_offset, node)
        return node

    def inline_paragraph(self, text: str) -> list[nodes.Node]:
        if not text:
            return []
        parsed, _ = self.state.inline_text(text, self.lineno)
        return [nodes.paragraph(text, "", *parsed)]


class _Version(_SphinxDirective):
    def run(self):
        version, _, summary = self.argument().partition(" ")
        node = sphinx_version(label=_VERSION_LABELS[self.name.lower()], version=version)
        node += self.inline_paragraph(summary)
        return [self.parse_body(node)]


class _Definition(_SphinxDirective):
    def run(self):
        return [self.parse_body(sphinx_definition(signature=self.argument()))]


class _Code(_SphinxDirective):
    def run(self):
        code = "\n".join(self.content)
        node = nodes.literal_block(code, code)
        language = self.argument().split(" ")[0]
        node["language"] = "" if language.lower() in _NO_LANGUAGE else language
        return [node]


class _Admonition(_SphinxDirective):
    def run(self):
        argument = self.argument()
        if self.name.lower() == "admonition":
            node = sphinx_admonition(label=argument or "Admonition")
        else:
            node = sphinx_admonition(label=self.name.lower().capitalize())
            node += self.inline_paragraph(argument)
        return [self.parse_body(node)]


class _Module(_SphinxDirective):
    def run(self):
        return [sphinx_module(name=self.argument())]


class _Ignored(_SphinxDirective):
    def run(self):
        return []


class _Unknown(_SphinxDirective):
    """Directiva que ni docutils ni Sphinx-aquí conocen: se conserva el cuerpo."""

    def run(self):
        return [self.parse_body(nodes.container())]


def _register() -> None:
    for name in _VERSION_LABELS:
        directives.register_directive(name, _Version)
    for name in (*_DEFINITIONS, *(f"py:{n}" for n in _DEFINITIONS), *_AUTO_DEFINITIONS):
        directives.register_directive(name, _Definition)
    for name in _CODE:
        directives.register_directive(name, _Code)
    for name in _ADMONITIONS:
        directives.register_directive(name, _Admonition)
    for name in _MODULES:
        directives.register_directive(name, _Module)
    for name in _IGNORED:
        directives.register_directive(name, _Ignored)


def _generic_role(name, rawtext, text, lineno, inliner, options=None, content=None):
    """Cualquier rol de Sphinx (:func:, :ref:, :py:class:…): se queda el texto visible en código."""
    text = utils.unescape(text)
    m = re.match(r"^(.*?)\s*<([^<>]*)>$", text, re.S)
    shown = (m.group(1) or m.group(2)) if m else text
    return [nodes.literal(rawtext, shown.strip().lstrip("~!"))], []


_LOCK = threading.RLock()


@contextmanager
def _lenient_lookups():
    """Durante el parseo, los roles y las directivas desconocidos no son un error."""
    with _LOCK:
        find_role, find_directive = roles.role, directives.directive

        def role(name, language_module, lineno, reporter):
            function, messages = find_role(name, language_module, lineno, reporter)
            return (function, messages) if function else (_generic_role, [])

        def directive(name, language_module, document):
            directive_class, messages = find_directive(name, language_module, document)
            return (directive_class, messages) if directive_class else (_Unknown, [])

        roles.role, directives.directive = role, directive
        try:
            yield
        finally:
            roles.role, directives.directive = find_role, find_directive


_register()


def _settings() -> dict:
    return {
        "_disable_config": True,
        "report_level": 5,
        "halt_level": 5,
        "warning_stream": io.StringIO(),
        "file_insertion_enabled": False,
        "raw_enabled": False,
        "doctitle_xform": False,
        "sectsubtitle_xform": False,
        "docinfo_xform": False,
        "syntax_highlight": "none",
        "input_encoding": "unicode",
    }


def parse(text: str) -> nodes.document:
    with _lenient_lookups():
        return publish_doctree(text, settings_overrides=_settings())


# --- Recorrido del árbol ---


def _flat(text: str) -> str:
    return " ".join(text.split())


def _quote(lines: list[str]) -> list[str]:
    return [f"> {l}" if l else ">" for l in lines]


def _indent(lines: list[str], pad: str) -> list[str]:
    return [pad + l if l else "" for l in lines]


class _Writer:
    def __init__(self) -> None:
        self.level = 0

    # Bloques: cada método devuelve las líneas del bloque; `blocks` los separa con una línea en blanco.

    def blocks(self, children) -> list[str]:
        lines: list[str] = []
        for child in children:
            block = [] if isinstance(child, nodes.Text) else getattr(self, f"block_{child.tagname}", self.block_children)(child)
            if block:
                if lines:
                    lines.append("")
                lines += block
        return lines

    def block_children(self, node) -> list[str]:
        return self.blocks(node.children)

    def block_skip(self, node) -> list[str]:
        return []

    block_comment = block_target = block_substitution_definition = block_system_message = block_pending = block_raw = block_image = block_skip

    def block_paragraph(self, node) -> list[str]:
        return self.inline(node).split("\n")

    def block_title(self, node) -> list[str]:
        return [f"**{_flat(self.inline(node))}**"]

    block_subtitle = block_rubric = block_title

    def block_section(self, node) -> list[str]:
        self.level += 1
        try:
            title = next((c for c in node.children if isinstance(c, nodes.title)), None)
            lines = [] if title is None else ["#" * min(self.level, 6) + " " + _flat(self.inline(title))]
            body = self.blocks(c for c in node.children if c is not title)
            return lines + (["", *body] if body else [])
        finally:
            self.level -= 1

    def block_literal_block(self, node) -> list[str]:
        code = node.astext()
        fence = "```"
        while fence in code:
            fence += "`"
        return [fence + node.get("language", ""), *(code.split("\n") if code else []), fence]

    block_doctest_block = block_literal_block

    def block_math_block(self, node) -> list[str]:
        return ["$$", *node.astext().split("\n"), "$$"]

    def block_transition(self, node) -> list[str]:
        return ["---"]

    def items(self, node, marker) -> list[str]:
        lines: list[str] = []
        for number, item in enumerate(node.children):
            body = self.blocks(item.children)
            prefix = marker(number)
            if not body:
                lines.append(prefix.rstrip())
                continue
            lines.append(prefix + body[0])
            lines += _indent(body[1:], " " * len(prefix))
        return lines

    def block_bullet_list(self, node) -> list[str]:
        return self.items(node, lambda n: "- ")

    def block_enumerated_list(self, node) -> list[str]:
        start = node.get("start", 1)
        return self.items(node, lambda n: f"{start + n}. ")

    def block_definition_list(self, node) -> list[str]:
        lines: list[str] = []
        for item in node.children:
            term = next((c for c in item.children if isinstance(c, nodes.term)), None)
            classifiers = [_flat(self.inline(c)) for c in item.children if isinstance(c, nodes.classifier)]
            definition = next((c for c in item.children if isinstance(c, nodes.definition)), None)
            if lines:
                lines.append("")
            lines.append(f"**{_flat(self.inline(term))}**" + "".join(f" ({c})" for c in classifiers) if term is not None else "")
            if definition is not None:
                lines += _indent(self.blocks(definition.children), "    ")
        return lines

    def block_field_list(self, node) -> list[str]:
        lines: list[str] = []
        for field in node.children:
            name = _flat(self.inline(field.children[0]))
            body = self.blocks(field.children[1].children) if len(field.children) > 1 else []
            lines.append(f"**{name}:** " + (body[0] if body else "").rstrip())
            lines += _indent(body[1:], "    ")
        return lines

    def block_option_list(self, node) -> list[str]:
        lines: list[str] = []
        for item in node.children:
            group, description = item.children[0], item.children[-1]
            body = self.blocks(description.children)
            lines.append(", ".join(f"`{_flat(o.astext())}`" for o in group.children) + (" " + body[0] if body else ""))
            lines += _indent(body[1:], "    ")
        return lines

    def block_block_quote(self, node) -> list[str]:
        attribution = [c for c in node.children if isinstance(c, nodes.attribution)]
        lines = self.blocks(c for c in node.children if not isinstance(c, nodes.attribution))
        if attribution:
            lines += ["", "— " + _flat(self.inline(attribution[0]))]
        return _quote(lines)

    def block_line_block(self, node) -> list[str]:
        lines: list[str] = []
        for child in node.children:
            lines += _indent(self.block_line_block(child), "  ") if isinstance(child, nodes.line_block) else self.inline(child).split("\n")
        return lines

    def block_footnote(self, node) -> list[str]:
        label = next((c for c in node.children if isinstance(c, nodes.label)), None)
        body = self.blocks(c for c in node.children if c is not label)
        if label is not None and body:
            body[0] = f"[{label.astext()}] {body[0]}"
        return body

    block_citation = block_footnote

    def block_table(self, node) -> list[str]:
        caption = [self.block_title(c)[0] for c in node.children if isinstance(c, nodes.title)]
        rows: list[list[str]] = []
        for group in (c for c in node.children if isinstance(c, nodes.tgroup)):
            for part in (c for c in group.children if isinstance(c, (nodes.thead, nodes.tbody))):
                rows += [[self.cell(e) for e in row.children] for row in part.children]
        if not rows:
            return caption
        width = max(len(r) for r in rows)
        rows = [r + [""] * (width - len(r)) for r in rows]
        lines = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
        lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
        return [*caption, *([""] if caption else []), *lines]

    def cell(self, entry) -> str:
        return _flat(" ".join(self.blocks(entry.children))).replace("|", "\\|")

    # Nodos propios de Sphinx

    def block_sphinx_version(self, node) -> list[str]:
        children = list(node.children)
        summary = ""
        if children and isinstance(children[0], nodes.paragraph):
            summary = _flat(self.inline(children.pop(0)))
        head = f"{node['label']} {node['version']}" + (f": {summary}" if summary else "")
        body = self.blocks(children)
        return [head, *(["", *body] if body else [])]

    def block_sphinx_definition(self, node) -> list[str]:
        body = self.blocks(node.children)
        return [f"`{node['signature']}`", ":   " + body[0] if body else ":   ", *_indent(body[1:], "    ")]

    def block_sphinx_admonition(self, node) -> list[str]:
        children = list(node.children)
        head = f"**{node['label']}:**"
        if children and isinstance(children[0], nodes.paragraph):
            first = self.inline(children.pop(0)).split("\n")
            head, tail = f"{head} {first[0]}", first[1:]
        else:
            tail = []
        body = self.blocks(children)
        return _quote([head, *tail, *(["", *body] if body else [])])

    def block_sphinx_module(self, node) -> list[str]:
        return [f"Module: `{node['name']}`"]

    # En línea

    def inline(self, node) -> str:
        return "".join(self.span(c) for c in node.children)

    def span(self, node) -> str:
        if isinstance(node, nodes.Text):
            return node.astext()
        return getattr(self, f"span_{node.tagname}", self.inline)(node)

    def span_skip(self, node) -> str:
        return ""

    span_system_message = span_raw = span_comment = span_image = span_skip

    def span_emphasis(self, node) -> str:
        return f"*{self.inline(node)}*"

    def span_strong(self, node) -> str:
        return f"**{self.inline(node)}**"

    def span_literal(self, node) -> str:
        text = node.astext()
        fence = "``" if "`" in text else "`"
        return f"{fence}{text}{fence}"

    span_title_reference = span_literal

    def span_math(self, node) -> str:
        return f"${node.astext()}$"

    def span_reference(self, node) -> str:
        text, uri = self.inline(node), node.get("refuri", "")
        return f"[{text}]({uri})" if uri and text != uri else text

    def span_footnote_reference(self, node) -> str:
        return f"[{node.astext()}]"

    span_citation_reference = span_footnote_reference


def convert(text: str) -> str:
    """Markdown (sin limpiar) del RST; puede lanzar si docutils no puede con el fichero."""
    return "\n".join(_Writer().blocks(parse(text).children))
