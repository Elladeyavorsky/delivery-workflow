"""Perfiles de documentación: qué metadatos marca cada tipo de forma fiable y cómo se calculan.

Todos los fragmentos llevan el núcleo común. Cada perfil añade sus campos. Si ningún perfil
reconoce la documentación, se usa `generic` (solo el núcleo). Son funciones puras sobre texto.
"""

from __future__ import annotations

import re
from pathlib import PurePosixPath

CORE_FIELDS = ("package", "version", "ecosystem", "doc_type", "source", "heading_path", "text", "has_code", "deprecated")

EXTRA_FIELDS: dict[str, tuple[str, ...]] = {
    "sphinx": ("module", "symbols", "added_in", "changed_in"),
    "mkdocs": ("module", "symbols", "page_type"),
    "markdown": ("symbols", "page_type", "code_language"),
    "node": ("module", "symbols", "added_in", "stability"),
    "typedoc": ("symbols", "symbol_kind"),
    "go": ("import_path", "symbols", "symbol_kind", "receiver", "has_example"),
    "rust": ("module", "symbols", "symbol_kind", "feature"),
    "generic": (),
}

# Campos por los que el agente puede filtrar en query_docs (además de package, que es siempre).
BOOLEANS = ("has_code", "deprecated", "has_example")


def filters_for(doc_type: str) -> list[str]:
    """Campos filtrables de un perfil: sus campos extra más los booleanos que tiene."""
    extra = list(EXTRA_FIELDS.get(doc_type, ()))
    return extra + [b for b in BOOLEANS if b in ("has_code", "deprecated") or b in extra]


_FENCE = re.compile(r"^\s*(```|~~~)")
_LANGUAGE = re.compile(r"^\s*(?:```|~~~)\s*([A-Za-z0-9_+#.-]+)")


def has_code(text: str) -> bool:
    return any(_FENCE.match(l) for l in text.splitlines())


# --- Señales de obsolescencia por perfil ---

_DEPRECATED = {
    "sphinx": re.compile(r"(?im)^\s*(?:Deprecated since version|\.\. deprecated::)"),
    "mkdocs": re.compile(r"(?im)^\s*(?:!!!\s*\w+\s*\"?deprecated|\?\?\?\s*\w+\s*\"?deprecated|deprecated\b|<small>deprecated)"),
    "markdown": re.compile(r"(?im)(?:^\s*(?:>\s*)?(?:\*\*|__)?\s*(?:⚠️\s*)?deprecated\b|<Deprecated\b|^\s*:::\s*\w*\s*deprecated|<Badge[^>]*deprecated)"),
    "node": re.compile(r"(?im)(?:Stability:\s*0\b|^\s*deprecated:\s*)"),
    "typedoc": re.compile(r"(?im)(?:@deprecated|\*\*`?Deprecated`?\*\*|^#+\s*Deprecated\b)"),
    "go": re.compile(r"(?m)^\s*Deprecated:"),
    "rust": re.compile(r"(?im)(?:Deprecated since|#\[deprecated|👎)"),
    "generic": re.compile(r"(?im)^\s*(?:>\s*)?(?:\*\*)?\s*deprecated\b"),
}


def deprecated(doc_type: str, text: str) -> bool:
    return bool(_DEPRECATED.get(doc_type, _DEPRECATED["generic"]).search(text))


# --- Ayudas ---


def _unique(field_values) -> list[str]:
    seen: list[str] = []
    for v in field_values:
        v = v.strip()
        if v and v not in seen:
            seen.append(v)
    return seen


def _symbol_name(text: str) -> str:
    """`fs.readFile(path, cb)` → fs.readFile; quita comillas invertidas, escapes y prefijos."""
    t = text.replace("`", "").replace("\\", "").strip()
    t = re.sub(r"^(?:Class|Function|Interface|Type Alias|Variable|Enumeration|Namespace|Method|Property|Event|Static method):\s*", "", t)
    t = t.split("(", 1)[0].strip()
    words = t.split()
    return words[-1] if words else ""


def page_type(source: str) -> str:
    segments = PurePosixPath(source).parts
    return segments[0] if len(segments) > 1 else ""


# --- Metadatos a nivel de fichero ---

_H1_QUOTED = re.compile(r"^#\s+`([^`]+)`", re.M)
_H1 = re.compile(r"^#\s+(.+)$", re.M)
_MKDOCSTRINGS = re.compile(r"^:::\s*([A-Za-z_][\w.]*)", re.M)
_NODE_SOURCE = re.compile(r"<!--\s*source_link=lib/([\w/]+)\.js\s*-->")
_GO_IMPORT = re.compile(r'^import\s+"([^"]+)"', re.M)


def file_metadata(doc_type: str, source: str, content: str) -> dict:
    """Lo que vale para todo el fichero: módulo, tipo de página o paquete de Go."""
    meta: dict = {}
    if doc_type == "sphinx":
        m = _H1_QUOTED.search(content)
        if m:
            meta["module"] = m.group(1).replace("\\", "").strip()
        elif source.startswith("library/"):
            meta["module"] = PurePosixPath(source).stem.split("-")[0]
        else:
            meta["module"] = ""
    elif doc_type == "mkdocs":
        m = _MKDOCSTRINGS.search(content) or _H1_QUOTED.search(content)
        meta["module"] = m.group(1) if m else ""
        meta["page_type"] = page_type(source)
    elif doc_type == "markdown":
        meta["page_type"] = page_type(source)
    elif doc_type == "node":
        m = _NODE_SOURCE.search(content)
        stem = m.group(1) if m else PurePosixPath(source).stem
        meta["module"] = f"node:{stem}"
    elif doc_type == "go":
        m = _GO_IMPORT.search(content)
        meta["import_path"] = m.group(1) if m else ""
    return meta


# --- Metadatos de cada fragmento ---

_ADDED = re.compile(r"(?:Added|New) in version (\d+(?:\.\d+)+)")
_CHANGED = re.compile(r"Changed in version (\d+(?:\.\d+)+)")
_DEF_LINE = re.compile(r"^\s*:(\s|$)")
_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$", re.M)
_NODE_YAML = re.compile(r"<!--\s*YAML(.*?)-->", re.S)
_NODE_ADDED = re.compile(r"^\s*added:\s*(.*?)(?=^\s*\w+:|\Z)", re.S | re.M)
_STABILITY = re.compile(r"Stability:\s*(\d(?:\.\d)?)")
_TABLE_FIRST_CELL = re.compile(r"^\|\s*`([^`|]+)`\s*\|", re.M)
_TYPEDOC_KIND = re.compile(r"^#+\s*(Function|Class|Interface|Type Alias|Variable|Enumeration|Namespace):\s*(.+)$", re.M)
_TYPEDOC_SECTION = {"Functions": "function", "Classes": "class", "Interfaces": "interface", "Type Aliases": "type", "Variables": "variable", "Enumerations": "enum", "Namespaces": "namespace", "Methods": "method", "Properties": "property"}
_GO_DECL = re.compile(r"^#{2,3}\s+(func|type|const|var)\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)?", re.M)
_RUST_ITEM = re.compile(r"^#{2,3}\s+(struct|enum|trait|fn|macro|type|const|static|union|method|mod)\s+`([^`]+)`", re.M)
_RUST_FEATURE = re.compile(r"Available on (?:crate )?features? (.+?) only", re.I)


def _definition_terms(text: str) -> list[str]:
    lines = text.splitlines()
    names = []
    for i, line in enumerate(lines[:-1]):
        if line.strip() and not _DEF_LINE.match(line) and _DEF_LINE.match(lines[i + 1]):
            names.append(_symbol_name(line))
    return names


def _headings(text: str) -> list[tuple[int, str]]:
    return [(len(m.group(1)), m.group(2)) for m in _HEADING.finditer(text)]


def _yaml_added_versions(text: str) -> list[str]:
    versions: list[str] = []
    for block in _NODE_YAML.findall(text):
        m = _NODE_ADDED.search(block)
        if m:
            versions += [v.lstrip("v") for v in re.findall(r"v\d+(?:\.\d+)+", m.group(1))]
    return _unique(versions)


def chunk_metadata(doc_type: str, text: str, doc_file: dict | None = None) -> dict:
    """Núcleo calculable (has_code, deprecated) más los campos del perfil para un fragmento."""
    doc_file = doc_file or {}
    meta: dict = {"has_code": has_code(text), "deprecated": deprecated(doc_type, text)}
    if doc_type == "sphinx":
        meta["module"] = doc_file.get("module", "")
        meta["symbols"] = _unique(_definition_terms(text) + [_symbol_name(t) for _, t in _headings(text) if "`" in t])
        meta["added_in"] = _unique(_ADDED.findall(text))
        meta["changed_in"] = _unique(_CHANGED.findall(text))
    elif doc_type == "mkdocs":
        meta["module"] = doc_file.get("module", "")
        meta["page_type"] = doc_file.get("page_type", "")
        meta["symbols"] = _unique([_symbol_name(t) for _, t in _headings(text) if "`" in t or "(" in t] + [m.group(1).split(".")[-1] for m in _MKDOCSTRINGS.finditer(text)])
    elif doc_type == "markdown":
        meta["page_type"] = doc_file.get("page_type", "")
        meta["symbols"] = _unique([_symbol_name(t) for _, t in _headings(text) if "`" in t] + [_symbol_name(s) for s in _TABLE_FIRST_CELL.findall(text)])
        meta["code_language"] = _unique(m.group(1).lower() for l in text.splitlines() if (m := _LANGUAGE.match(l)))
    elif doc_type == "node":
        meta["module"] = doc_file.get("module", "")
        meta["symbols"] = _unique(_symbol_name(t) for _, t in _headings(text) if "`" in t)
        meta["added_in"] = _yaml_added_versions(text)
        m = _STABILITY.search(text)
        meta["stability"] = m.group(1) if m else ""
    elif doc_type == "typedoc":
        symbols, kinds = [], []
        for m in _TYPEDOC_KIND.finditer(text):
            kinds.append(m.group(1).lower().replace("type alias", "type").replace("enumeration", "enum"))
            symbols.append(_symbol_name(m.group(2)))
        section = None
        for level, t in _headings(text):
            if t.strip() in _TYPEDOC_SECTION:
                section = _TYPEDOC_SECTION[t.strip()]
            elif section and level >= 3:
                symbols.append(_symbol_name(t))
                kinds.append(section)
        meta["symbols"] = _unique(symbols)
        meta["symbol_kind"] = _unique(kinds)
    elif doc_type == "go":
        meta["import_path"] = doc_file.get("import_path", "")
        symbols, kinds, receivers = [], [], []
        for m in _GO_DECL.finditer(text):
            class_name, _, receiver, name = m.groups()
            if receiver:
                symbols.append(f"{receiver}.{name}")
                kinds.append("method")
                receivers.append(receiver)
            elif name:
                symbols.append(name)
                kinds.append(class_name)
        meta["symbols"] = _unique(symbols)
        meta["symbol_kind"] = _unique(kinds)
        meta["receiver"] = _unique(receivers)
        meta["has_example"] = bool(re.search(r"(?m)^#{2,4}\s+Example", text))
    elif doc_type == "rust":
        symbols, kinds, modules = [], [], []
        for m in _RUST_ITEM.finditer(text):
            kinds.append(m.group(1))
            file_path = m.group(2)
            symbols.append(file_path)
            if "::" in file_path:
                modules.append(file_path.rsplit("::", 1)[0])
        meta["symbols"] = _unique(symbols)
        meta["symbol_kind"] = _unique(kinds)
        meta["module"] = modules[0] if modules else doc_file.get("module", "")
        features = []
        for m in _RUST_FEATURE.finditer(text):
            features += re.findall(r"[\w-]+", m.group(1).replace(" and ", " ").replace(" or ", " "))
        meta["feature"] = _unique(f for f in features if f not in ("and", "or"))
    return meta


# --- Detección del tipo de documentación ---

_SIGNALS = {
    "typedoc": re.compile(r"(?m)(?:^#+\s*(?:Function|Class|Interface|Type Alias):|^Defined in:?\s|\*\*Defined in\*\*)"),
    "sphinx": re.compile(r"(?m)(?:Added in version|New in version|Changed in version|Deprecated since version|^:\s{3})"),
    "mkdocs": re.compile(r"(?m)(?:^!!!\s+\w+|^:::\s*[A-Za-z_])"),
}


def detect_doc_type(files: dict[str, str], hint: str | None = None) -> str:
    """Tipo de documentación de un paquete a partir de sus ficheros (ruta → Markdown).

    `pista` la da la fuente cuando lo sabe seguro (node, go, rust, sphinx, mkdocs). Si no, se
    cuentan las señales del texto. Si nada encaja, markdown cuando hay ficheros y generic si no.
    """
    if hint in EXTRA_FIELDS:
        return hint
    if not files:
        return "generic"
    occurrence_counts = {doc_type: sum(1 for t in files.values() if rx.search(t)) for doc_type, rx in _SIGNALS.items()}
    best = max(occurrence_counts, key=lambda k: occurrence_counts[k])
    if occurrence_counts[best] >= max(2, len(files) // 10):
        return best
    return "markdown"
