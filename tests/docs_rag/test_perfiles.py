from docs_rag.perfiles import CAMPOS_EXTRA, detectar_tipo, filtros_de, metadatos_fichero, metadatos_fragmento


def test_escenario_4_metadatos_por_perfil():
    sphinx = metadatos_fragmento("sphinx", "`asyncio.TaskGroup`\n:   Holds tasks.\n\nAdded in version 3.11\n", {"module": "asyncio"})
    assert sphinx["added_in"] == ["3.11"]
    assert sphinx["symbols"] == ["asyncio.TaskGroup"]
    assert sphinx["module"] == "asyncio"
    node = metadatos_fragmento("node", "### `fs.exists(path, callback)`\n\n> Stability: 0 - Deprecated: Use fs.stat().\n", {"module": "node:fs"})
    assert node["stability"] == "0"
    assert node["deprecated"] is True
    assert node["symbols"] == ["fs.exists"]
    rust = metadatos_fragmento("rust", "## trait `serde::Serialize`\n\nAvailable on crate feature derive only.\n\nA data structure.\n")
    assert rust["feature"] == ["derive"]
    assert rust["symbols"] == ["serde::Serialize"]
    assert rust["module"] == "serde"
    assert rust["symbol_kind"] == ["trait"]


def test_nucleo_tiene_codigo_y_deprecated_por_perfil():
    assert metadatos_fragmento("markdown", "texto\n\n```tsx\n<A/>\n```\n")["has_code"] is True
    assert metadatos_fragmento("go", "## func Old()\n\nDeprecated: use New.\n")["deprecated"] is True
    assert metadatos_fragmento("go", "## func New()\n\nNot deprecated here.\n")["deprecated"] is False
    assert metadatos_fragmento("sphinx", "Deprecated since version 3.12: gone.\n")["deprecated"] is True
    assert metadatos_fragmento("typedoc", "### foo()\n\n**`Deprecated`**\n")["deprecated"] is True


def test_sphinx_changed_in_y_modulo_por_fichero():
    assert metadatos_fragmento("sphinx", "Changed in version 3.12: x.\nNew in version 3.4.\n")["changed_in"] == ["3.12"]
    assert metadatos_fichero("sphinx", "library/asyncio-task.md", "# Coroutines and Tasks\n")["module"] == "asyncio"
    assert metadatos_fichero("sphinx", "library/os.md", "# `os` — Misc\n")["module"] == "os"


def test_node_added_in_desde_yaml():
    texto = "### `fs.cp(src, dest)`\n\n<!-- YAML\nadded: v16.7.0\nchanges:\n  - version: v17.6.0\n-->\n\n> Stability: 1 - Experimental\n"
    meta = metadatos_fragmento("node", texto)
    assert meta["added_in"] == ["16.7.0"]
    assert meta["stability"] == "1"
    assert metadatos_fichero("node", "fs.md", "<!-- source_link=lib/fs.js -->\n")["module"] == "node:fs"


def test_markdown_simbolos_tablas_y_lenguajes():
    texto = "## `useState`\n\n| Clase | CSS |\n|---|---|\n| `flex` | display: flex |\n\n```jsx\nx\n```\n```css\ny\n```\n"
    meta = metadatos_fragmento("markdown", texto, metadatos_fichero("markdown", "reference/hooks.md", texto))
    assert meta["symbols"] == ["useState", "flex"]
    assert meta["code_language"] == ["jsx", "css"]
    assert meta["page_type"] == "reference"


def test_mkdocs_typedoc_y_go():
    mk = metadatos_fragmento("mkdocs", "::: fastapi.FastAPI\n\n## `include_router()`\n", metadatos_fichero("mkdocs", "reference/fastapi.md", "::: fastapi.FastAPI\n"))
    assert mk["module"] == "fastapi.FastAPI"
    assert "include_router" in mk["symbols"]
    td = metadatos_fragmento("typedoc", "# Function: createStore()\n\n## Interfaces\n\n### StoreApi\n")
    assert td["symbols"] == ["createStore", "StoreApi"]
    assert td["symbol_kind"] == ["function", "interface"]
    go = metadatos_fragmento("go", "## type Engine struct\n\n### func (engine *Engine) Run(addr ...string) (err error)\n\n#### ExampleEngine_Run\n", {"import_path": "github.com/gin-gonic/gin"})
    assert go["symbols"] == ["Engine", "Engine.Run"]
    assert go["symbol_kind"] == ["type", "method"]
    assert go["receiver"] == ["Engine"]
    assert go["has_example"] is True


def test_filtros_por_perfil():
    assert filtros_de("generic") == ["has_code", "deprecated"]
    assert "has_example" in filtros_de("go")
    assert "has_example" not in filtros_de("sphinx")
    assert set(CAMPOS_EXTRA["rust"]) <= set(filtros_de("rust"))


def test_detectar_tipo_con_pista_senales_y_por_defecto():
    assert detectar_tipo({"a.md": "x"}, "node") == "node"
    sphinx = {f"{i}.md": "Added in version 3.1\n" for i in range(5)}
    assert detectar_tipo(sphinx) == "sphinx"
    assert detectar_tipo({"a.md": "# Hola\n"}) == "markdown"
    assert detectar_tipo({}) == "generic"
