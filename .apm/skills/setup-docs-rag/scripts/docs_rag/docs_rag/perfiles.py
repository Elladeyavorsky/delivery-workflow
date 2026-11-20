"""Perfiles de documentación: qué metadatos marca cada tipo de forma fiable y cómo se calculan.

Todos los fragmentos llevan el núcleo común. Cada perfil añade sus campos. Si ningún perfil
reconoce la documentación, se usa `generico` (solo el núcleo). Son funciones puras sobre texto.
"""

from __future__ import annotations

import re
from pathlib import PurePosixPath

NUCLEO = ("paquete", "version", "ecosistema", "tipo_doc", "fuente", "ruta_titulos", "texto", "tiene_codigo", "deprecated")

CAMPOS_EXTRA: dict[str, tuple[str, ...]] = {
    "sphinx": ("modulo", "simbolos", "added_in", "changed_in"),
    "mkdocs": ("modulo", "simbolos", "tipo_pagina"),
    "markdown": ("simbolos", "tipo_pagina", "lenguaje_codigo"),
    "node": ("modulo", "simbolos", "added_in", "estabilidad"),
    "typedoc": ("simbolos", "tipo_simbolo"),
    "go": ("paquete_import", "simbolos", "tipo_simbolo", "receptor", "tiene_ejemplo"),
    "rust": ("modulo", "simbolos", "tipo_simbolo", "feature"),
    "generico": (),
}

# Campos por los que el agente puede filtrar en consultar_docs (además de paquete, que es siempre).
BOOLEANOS = ("tiene_codigo", "deprecated", "tiene_ejemplo")


def filtros_de(tipo: str) -> list[str]:
    """Campos filtrables de un perfil: sus campos extra más los booleanos que tiene."""
    extra = list(CAMPOS_EXTRA.get(tipo, ()))
    return extra + [b for b in BOOLEANOS if b in ("tiene_codigo", "deprecated") or b in extra]


_VALLA = re.compile(r"^\s*(```|~~~)")
_LENGUAJE = re.compile(r"^\s*(?:```|~~~)\s*([A-Za-z0-9_+#.-]+)")


def tiene_codigo(texto: str) -> bool:
    return any(_VALLA.match(l) for l in texto.splitlines())


# --- Señales de obsolescencia por perfil ---

_DEPRECATED = {
    "sphinx": re.compile(r"(?im)^\s*(?:Deprecated since version|\.\. deprecated::)"),
    "mkdocs": re.compile(r"(?im)^\s*(?:!!!\s*\w+\s*\"?deprecated|\?\?\?\s*\w+\s*\"?deprecated|deprecated\b|<small>deprecated)"),
    "markdown": re.compile(r"(?im)(?:^\s*(?:>\s*)?(?:\*\*|__)?\s*(?:⚠️\s*)?deprecated\b|<Deprecated\b|^\s*:::\s*\w*\s*deprecated|<Badge[^>]*deprecated)"),
    "node": re.compile(r"(?im)(?:Stability:\s*0\b|^\s*deprecated:\s*)"),
    "typedoc": re.compile(r"(?im)(?:@deprecated|\*\*`?Deprecated`?\*\*|^#+\s*Deprecated\b)"),
    "go": re.compile(r"(?m)^\s*Deprecated:"),
    "rust": re.compile(r"(?im)(?:Deprecated since|#\[deprecated|👎)"),
    "generico": re.compile(r"(?im)^\s*(?:>\s*)?(?:\*\*)?\s*deprecated\b"),
}


def deprecated(tipo: str, texto: str) -> bool:
    return bool(_DEPRECATED.get(tipo, _DEPRECATED["generico"]).search(texto))


# --- Ayudas ---


def _unicos(valores) -> list[str]:
    vistos: list[str] = []
    for v in valores:
        v = v.strip()
        if v and v not in vistos:
            vistos.append(v)
    return vistos


def _nombre_simbolo(texto: str) -> str:
    """`fs.readFile(path, cb)` → fs.readFile; quita comillas invertidas, escapes y prefijos."""
    t = texto.replace("`", "").replace("\\", "").strip()
    t = re.sub(r"^(?:Class|Function|Interface|Type Alias|Variable|Enumeration|Namespace|Method|Property|Event|Static method):\s*", "", t)
    t = t.split("(", 1)[0].strip()
    palabras = t.split()
    return palabras[-1] if palabras else ""


def tipo_pagina(fuente: str) -> str:
    partes = PurePosixPath(fuente).parts
    return partes[0] if len(partes) > 1 else ""


# --- Metadatos a nivel de fichero ---

_H1_COMILLAS = re.compile(r"^#\s+`([^`]+)`", re.M)
_H1 = re.compile(r"^#\s+(.+)$", re.M)
_MKDOCSTRINGS = re.compile(r"^:::\s*([A-Za-z_][\w.]*)", re.M)
_NODE_SOURCE = re.compile(r"<!--\s*source_link=lib/([\w/]+)\.js\s*-->")
_GO_IMPORT = re.compile(r'^import\s+"([^"]+)"', re.M)


def metadatos_fichero(tipo: str, fuente: str, contenido: str) -> dict:
    """Lo que vale para todo el fichero: módulo, tipo de página o paquete de Go."""
    meta: dict = {}
    if tipo == "sphinx":
        m = _H1_COMILLAS.search(contenido)
        if m:
            meta["modulo"] = m.group(1).replace("\\", "").strip()
        elif fuente.startswith("library/"):
            meta["modulo"] = PurePosixPath(fuente).stem.split("-")[0]
        else:
            meta["modulo"] = ""
    elif tipo == "mkdocs":
        m = _MKDOCSTRINGS.search(contenido) or _H1_COMILLAS.search(contenido)
        meta["modulo"] = m.group(1) if m else ""
        meta["tipo_pagina"] = tipo_pagina(fuente)
    elif tipo == "markdown":
        meta["tipo_pagina"] = tipo_pagina(fuente)
    elif tipo == "node":
        m = _NODE_SOURCE.search(contenido)
        stem = m.group(1) if m else PurePosixPath(fuente).stem
        meta["modulo"] = f"node:{stem}"
    elif tipo == "go":
        m = _GO_IMPORT.search(contenido)
        meta["paquete_import"] = m.group(1) if m else ""
    return meta


# --- Metadatos de cada fragmento ---

_ADDED = re.compile(r"(?:Added|New) in version (\d+(?:\.\d+)+)")
_CHANGED = re.compile(r"Changed in version (\d+(?:\.\d+)+)")
_DEF_LINEA = re.compile(r"^\s*:(\s|$)")
_ENCABEZADO = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$", re.M)
_NODE_YAML = re.compile(r"<!--\s*YAML(.*?)-->", re.S)
_NODE_ADDED = re.compile(r"^\s*added:\s*(.*?)(?=^\s*\w+:|\Z)", re.S | re.M)
_ESTABILIDAD = re.compile(r"Stability:\s*(\d(?:\.\d)?)")
_TABLA_PRIMERA = re.compile(r"^\|\s*`([^`|]+)`\s*\|", re.M)
_TYPEDOC_TIPO = re.compile(r"^#+\s*(Function|Class|Interface|Type Alias|Variable|Enumeration|Namespace):\s*(.+)$", re.M)
_TYPEDOC_SECCION = {"Functions": "function", "Classes": "class", "Interfaces": "interface", "Type Aliases": "type", "Variables": "variable", "Enumerations": "enum", "Namespaces": "namespace", "Methods": "method", "Properties": "property"}
_GO_DECL = re.compile(r"^#{2,3}\s+(func|type|const|var)\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)?", re.M)
_RUST_ITEM = re.compile(r"^#{2,3}\s+(struct|enum|trait|fn|macro|type|const|static|union|method|mod)\s+`([^`]+)`", re.M)
_RUST_FEATURE = re.compile(r"Available on (?:crate )?features? (.+?) only", re.I)


def _terminos_definicion(texto: str) -> list[str]:
    lineas = texto.splitlines()
    nombres = []
    for i, linea in enumerate(lineas[:-1]):
        if linea.strip() and not _DEF_LINEA.match(linea) and _DEF_LINEA.match(lineas[i + 1]):
            nombres.append(_nombre_simbolo(linea))
    return nombres


def _encabezados(texto: str) -> list[tuple[int, str]]:
    return [(len(m.group(1)), m.group(2)) for m in _ENCABEZADO.finditer(texto)]


def _versiones_yaml_added(texto: str) -> list[str]:
    versiones: list[str] = []
    for bloque in _NODE_YAML.findall(texto):
        m = _NODE_ADDED.search(bloque)
        if m:
            versiones += [v.lstrip("v") for v in re.findall(r"v\d+(?:\.\d+)+", m.group(1))]
    return _unicos(versiones)


def metadatos_fragmento(tipo: str, texto: str, fichero: dict | None = None) -> dict:
    """Núcleo calculable (tiene_codigo, deprecated) más los campos del perfil para un fragmento."""
    fichero = fichero or {}
    meta: dict = {"tiene_codigo": tiene_codigo(texto), "deprecated": deprecated(tipo, texto)}
    if tipo == "sphinx":
        meta["modulo"] = fichero.get("modulo", "")
        meta["simbolos"] = _unicos(_terminos_definicion(texto) + [_nombre_simbolo(t) for _, t in _encabezados(texto) if "`" in t])
        meta["added_in"] = _unicos(_ADDED.findall(texto))
        meta["changed_in"] = _unicos(_CHANGED.findall(texto))
    elif tipo == "mkdocs":
        meta["modulo"] = fichero.get("modulo", "")
        meta["tipo_pagina"] = fichero.get("tipo_pagina", "")
        meta["simbolos"] = _unicos([_nombre_simbolo(t) for _, t in _encabezados(texto) if "`" in t or "(" in t] + [m.group(1).split(".")[-1] for m in _MKDOCSTRINGS.finditer(texto)])
    elif tipo == "markdown":
        meta["tipo_pagina"] = fichero.get("tipo_pagina", "")
        meta["simbolos"] = _unicos([_nombre_simbolo(t) for _, t in _encabezados(texto) if "`" in t] + [_nombre_simbolo(s) for s in _TABLA_PRIMERA.findall(texto)])
        meta["lenguaje_codigo"] = _unicos(m.group(1).lower() for l in texto.splitlines() if (m := _LENGUAJE.match(l)))
    elif tipo == "node":
        meta["modulo"] = fichero.get("modulo", "")
        meta["simbolos"] = _unicos(_nombre_simbolo(t) for _, t in _encabezados(texto) if "`" in t)
        meta["added_in"] = _versiones_yaml_added(texto)
        m = _ESTABILIDAD.search(texto)
        meta["estabilidad"] = m.group(1) if m else ""
    elif tipo == "typedoc":
        simbolos, tipos = [], []
        for m in _TYPEDOC_TIPO.finditer(texto):
            tipos.append(m.group(1).lower().replace("type alias", "type").replace("enumeration", "enum"))
            simbolos.append(_nombre_simbolo(m.group(2)))
        seccion = None
        for nivel, t in _encabezados(texto):
            if t.strip() in _TYPEDOC_SECCION:
                seccion = _TYPEDOC_SECCION[t.strip()]
            elif seccion and nivel >= 3:
                simbolos.append(_nombre_simbolo(t))
                tipos.append(seccion)
        meta["simbolos"] = _unicos(simbolos)
        meta["tipo_simbolo"] = _unicos(tipos)
    elif tipo == "go":
        meta["paquete_import"] = fichero.get("paquete_import", "")
        simbolos, tipos, receptores = [], [], []
        for m in _GO_DECL.finditer(texto):
            clase, _, receptor, nombre = m.groups()
            if receptor:
                simbolos.append(f"{receptor}.{nombre}")
                tipos.append("method")
                receptores.append(receptor)
            elif nombre:
                simbolos.append(nombre)
                tipos.append(clase)
        meta["simbolos"] = _unicos(simbolos)
        meta["tipo_simbolo"] = _unicos(tipos)
        meta["receptor"] = _unicos(receptores)
        meta["tiene_ejemplo"] = bool(re.search(r"(?m)^#{2,4}\s+Example", texto))
    elif tipo == "rust":
        simbolos, tipos, modulos = [], [], []
        for m in _RUST_ITEM.finditer(texto):
            tipos.append(m.group(1))
            ruta = m.group(2)
            simbolos.append(ruta)
            if "::" in ruta:
                modulos.append(ruta.rsplit("::", 1)[0])
        meta["simbolos"] = _unicos(simbolos)
        meta["tipo_simbolo"] = _unicos(tipos)
        meta["modulo"] = modulos[0] if modulos else fichero.get("modulo", "")
        features = []
        for m in _RUST_FEATURE.finditer(texto):
            features += re.findall(r"[\w-]+", m.group(1).replace(" and ", " ").replace(" or ", " "))
        meta["feature"] = _unicos(f for f in features if f not in ("and", "or"))
    return meta


# --- Detección del tipo de documentación ---

_SENALES = {
    "typedoc": re.compile(r"(?m)(?:^#+\s*(?:Function|Class|Interface|Type Alias):|^Defined in:?\s|\*\*Defined in\*\*)"),
    "sphinx": re.compile(r"(?m)(?:Added in version|New in version|Changed in version|Deprecated since version|^:\s{3})"),
    "mkdocs": re.compile(r"(?m)(?:^!!!\s+\w+|^:::\s*[A-Za-z_])"),
}


def detectar_tipo(ficheros: dict[str, str], pista: str | None = None) -> str:
    """Tipo de documentación de un paquete a partir de sus ficheros (ruta → Markdown).

    `pista` la da la fuente cuando lo sabe seguro (node, go, rust, sphinx, mkdocs). Si no, se
    cuentan las señales del texto. Si nada encaja, markdown cuando hay ficheros y generico si no.
    """
    if pista in CAMPOS_EXTRA:
        return pista
    if not ficheros:
        return "generico"
    cuentas = {tipo: sum(1 for t in ficheros.values() if rx.search(t)) for tipo, rx in _SENALES.items()}
    mejor = max(cuentas, key=lambda k: cuentas[k])
    if cuentas[mejor] >= max(2, len(ficheros) // 10):
        return mejor
    return "markdown"
