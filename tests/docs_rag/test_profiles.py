from docs_rag.profiles import EXTRA_FIELDS, detect_doc_type, filters_for, file_metadata, chunk_metadata


def test_scenario_4_metadata_by_profile():
    sphinx = chunk_metadata("sphinx", "`asyncio.TaskGroup`\n:   Holds tasks.\n\nAdded in version 3.11\n", {"module": "asyncio"})
    assert sphinx["added_in"] == ["3.11"]
    assert sphinx["symbols"] == ["asyncio.TaskGroup"]
    assert sphinx["module"] == "asyncio"
    node = chunk_metadata("node", "### `fs.exists(path, callback)`\n\n> Stability: 0 - Deprecated: Use fs.stat().\n", {"module": "node:fs"})
    assert node["stability"] == "0"
    assert node["deprecated"] is True
    assert node["symbols"] == ["fs.exists"]
    rust = chunk_metadata("rust", "## trait `serde::Serialize`\n\nAvailable on crate feature derive only.\n\nA data structure.\n")
    assert rust["feature"] == ["derive"]
    assert rust["symbols"] == ["serde::Serialize"]
    assert rust["module"] == "serde"
    assert rust["symbol_kind"] == ["trait"]


def test_core_has_code_and_deprecated_by_profile():
    assert chunk_metadata("markdown", "texto\n\n```tsx\n<A/>\n```\n")["has_code"] is True
    assert chunk_metadata("go", "## func Old()\n\nDeprecated: use New.\n")["deprecated"] is True
    assert chunk_metadata("go", "## func New()\n\nNot deprecated here.\n")["deprecated"] is False
    assert chunk_metadata("sphinx", "Deprecated since version 3.12: gone.\n")["deprecated"] is True
    assert chunk_metadata("typedoc", "### foo()\n\n**`Deprecated`**\n")["deprecated"] is True


def test_sphinx_changed_in_and_module_per_file():
    assert chunk_metadata("sphinx", "Changed in version 3.12: x.\nNew in version 3.4.\n")["changed_in"] == ["3.12"]
    assert file_metadata("sphinx", "library/asyncio-task.md", "# Coroutines and Tasks\n")["module"] == "asyncio"
    assert file_metadata("sphinx", "library/os.md", "# `os` — Misc\n")["module"] == "os"


def test_node_added_in_from_yaml():
    text = "### `fs.cp(src, dest)`\n\n<!-- YAML\nadded: v16.7.0\nchanges:\n  - version: v17.6.0\n-->\n\n> Stability: 1 - Experimental\n"
    meta = chunk_metadata("node", text)
    assert meta["added_in"] == ["16.7.0"]
    assert meta["stability"] == "1"
    assert file_metadata("node", "fs.md", "<!-- source_link=lib/fs.js -->\n")["module"] == "node:fs"


def test_markdown_symbols_tables_and_languages():
    text = "## `useState`\n\n| Clase | CSS |\n|---|---|\n| `flex` | display: flex |\n\n```jsx\nx\n```\n```css\ny\n```\n"
    meta = chunk_metadata("markdown", text, file_metadata("markdown", "reference/hooks.md", text))
    assert meta["symbols"] == ["useState", "flex"]
    assert meta["code_language"] == ["jsx", "css"]
    assert meta["page_type"] == "reference"


def test_mkdocs_typedoc_and_go():
    mk = chunk_metadata("mkdocs", "::: fastapi.FastAPI\n\n## `include_router()`\n", file_metadata("mkdocs", "reference/fastapi.md", "::: fastapi.FastAPI\n"))
    assert mk["module"] == "fastapi.FastAPI"
    assert "include_router" in mk["symbols"]
    td = chunk_metadata("typedoc", "# Function: createStore()\n\n## Interfaces\n\n### StoreApi\n")
    assert td["symbols"] == ["createStore", "StoreApi"]
    assert td["symbol_kind"] == ["function", "interface"]
    go = chunk_metadata("go", "## type Engine struct\n\n### func (engine *Engine) Run(addr ...string) (err error)\n\n#### ExampleEngine_Run\n", {"import_path": "github.com/gin-gonic/gin"})
    assert go["symbols"] == ["Engine", "Engine.Run"]
    assert go["symbol_kind"] == ["type", "method"]
    assert go["receiver"] == ["Engine"]
    assert go["has_example"] is True


def test_filters_by_profile():
    assert filters_for("generic") == ["has_code", "deprecated"]
    assert "has_example" in filters_for("go")
    assert "has_example" not in filters_for("sphinx")
    assert set(EXTRA_FIELDS["rust"]) <= set(filters_for("rust"))


def test_detect_doc_type_with_hint_signals_and_default():
    assert detect_doc_type({"a.md": "x"}, "node") == "node"
    sphinx = {f"{i}.md": "Added in version 3.1\n" for i in range(5)}
    assert detect_doc_type(sphinx) == "sphinx"
    assert detect_doc_type({"a.md": "# Hola\n"}) == "markdown"
    assert detect_doc_type({}) == "generic"
