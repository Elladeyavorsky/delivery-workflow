from docs_rag.perfiles import CAMPOS_EXTRA, detectar_tipo, filtros_de, metadatos_fichero, metadatos_fragmento


def test_escenario_4_metadatos_por_perfil():
    sphinx = metadatos_fragmento("sphinx", "`asyncio.TaskGroup`\n:   Holds tasks.\n\nAdded in version 3.11\n", {"modulo": "asyncio"})
    assert sphinx["added_in"] == ["3.11"]
    assert sphinx["simbolos"] == ["asyncio.TaskGroup"]
    assert sphinx["modulo"] == "asyncio"
    node = metadatos_fragmento("node", "### `fs.exists(path, callback)`\n\n> Stability: 0 - Deprecated: Use fs.stat().\n", {"modulo": "node:fs"})
    assert node["estabilidad"] == "0"
    assert node["deprecated"] is True
    assert node["simbolos"] == ["fs.exists"]
    rust = metadatos_fragmento("rust", "## trait `serde::Serialize`\n\nAvailable on crate feature derive only.\n\nA data structure.\n")
    assert rust["feature"] == ["derive"]
    assert rust["simbolos"] == ["serde::Serialize"]
    assert rust["modulo"] == "serde"
    assert rust["tipo_simbolo"] == ["trait"]


def test_nucleo_tiene_codigo_y_deprecated_por_perfil():
    assert metadatos_fragmento("markdown", "texto\n\n```tsx\n<A/>\n```\n")["tiene_codigo"] is True
    assert metadatos_fragmento("go", "## func Old()\n\nDeprecated: use New.\n")["deprecated"] is True
    assert metadatos_fragmento("go", "## func New()\n\nNot deprecated here.\n")["deprecated"] is False
    assert metadatos_fragmento("sphinx", "Deprecated since version 3.12: gone.\n")["deprecated"] is True
    assert metadatos_fragmento("typedoc", "### foo()\n\n**`Deprecated`**\n")["deprecated"] is True


def test_sphinx_changed_in_y_modulo_por_fichero():
    assert metadatos_fragmento("sphinx", "Changed in version 3.12: x.\nNew in version 3.4.\n")["changed_in"] == ["3.12"]
    assert metadatos_fichero("sphinx", "library/asyncio-task.md", "# Coroutines and Tasks\n")["modulo"] == "asyncio"
    assert metadatos_fichero("sphinx", "library/os.md", "# `os` — Misc\n")["modulo"] == "os"


def test_node_added_in_desde_yaml():
    texto = "### `fs.cp(src, dest)`\n\n<!-- YAML\nadded: v16.7.0\nchanges:\n  - version: v17.6.0\n-->\n\n> Stability: 1 - Experimental\n"
    meta = metadatos_fragmento("node", texto)
    assert meta["added_in"] == ["16.7.0"]
    assert meta["estabilidad"] == "1"
    assert metadatos_fichero("node", "fs.md", "<!-- source_link=lib/fs.js -->\n")["modulo"] == "node:fs"


def test_markdown_simbolos_tablas_y_lenguajes():
    texto = "## `useState`\n\n| Clase | CSS |\n|---|---|\n| `flex` | display: flex |\n\n```jsx\nx\n```\n```css\ny\n```\n"
    meta = metadatos_fragmento("markdown", texto, metadatos_fichero("markdown", "reference/hooks.md", texto))
    assert meta["simbolos"] == ["useState", "flex"]
    assert meta["lenguaje_codigo"] == ["jsx", "css"]
    assert meta["tipo_pagina"] == "reference"


def test_mkdocs_typedoc_y_go():
    mk = metadatos_fragmento("mkdocs", "::: fastapi.FastAPI\n\n## `include_router()`\n", metadatos_fichero("mkdocs", "reference/fastapi.md", "::: fastapi.FastAPI\n"))
    assert mk["modulo"] == "fastapi.FastAPI"
    assert "include_router" in mk["simbolos"]
    td = metadatos_fragmento("typedoc", "# Function: createStore()\n\n## Interfaces\n\n### StoreApi\n")
    assert td["simbolos"] == ["createStore", "StoreApi"]
    assert td["tipo_simbolo"] == ["function", "interface"]
    go = metadatos_fragmento("go", "## type Engine struct\n\n### func (engine *Engine) Run(addr ...string) (err error)\n\n#### ExampleEngine_Run\n", {"paquete_import": "github.com/gin-gonic/gin"})
    assert go["simbolos"] == ["Engine", "Engine.Run"]
    assert go["tipo_simbolo"] == ["type", "method"]
    assert go["receptor"] == ["Engine"]
    assert go["tiene_ejemplo"] is True


def test_filtros_por_perfil():
    assert filtros_de("generico") == ["tiene_codigo", "deprecated"]
    assert "tiene_ejemplo" in filtros_de("go")
    assert "tiene_ejemplo" not in filtros_de("sphinx")
    assert set(CAMPOS_EXTRA["rust"]) <= set(filtros_de("rust"))


def test_detectar_tipo_con_pista_senales_y_por_defecto():
    assert detectar_tipo({"a.md": "x"}, "node") == "node"
    sphinx = {f"{i}.md": "Added in version 3.1\n" for i in range(5)}
    assert detectar_tipo(sphinx) == "sphinx"
    assert detectar_tipo({"a.md": "# Hola\n"}) == "markdown"
    assert detectar_tipo({}) == "generico"
