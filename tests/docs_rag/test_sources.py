import json
import urllib.error

from fakes import FakeHttp, zip_with

from docs_rag import sources
from docs_rag.sources import fetch_docs, go_to_markdown, go_packages, github_repo, rustdoc_to_markdown, doc_paths


def test_github_repo_accepts_the_usual_forms():
    assert github_repo("git+https://github.com/axios/axios.git") == ("axios", "axios")
    assert github_repo("https://github.com/pallets/flask/tree/main") == ("pallets", "flask")
    assert github_repo("git@github.com:vercel/next.js.git") == ("vercel", "next.js")
    assert github_repo("https://gitlab.com/a/b") is None


def test_doc_paths_picks_docs_folders_and_respects_monorepos():
    tree = [
        {"type": "blob", "path": "docs/guide/intro.md"},
        {"type": "blob", "path": "docs/CHANGELOG.md"},
        {"type": "blob", "path": "src/index.ts"},
        {"type": "blob", "path": "README.md"},
        {"type": "blob", "path": "packages/core/docs/api.mdx"},
        {"type": "blob", "path": "packages/other/docs/api.mdx"},
        {"type": "tree", "path": "docs"},
    ]
    assert doc_paths(tree) == ["docs/guide/intro.md", "packages/core/docs/api.mdx", "packages/other/docs/api.mdx"]
    assert doc_paths(tree, "packages/core") == ["packages/core/docs/api.mdx"]


def test_go_to_markdown_builds_signatures_docs_methods_and_examples():
    code_text = {
        "gin.go": "// Package gin is a web framework.\npackage gin\n\n// Engine is the framework instance.\ntype Engine struct {\n}\n\n"
        "// Run attaches the router.\n// Deprecated: use RunTLS.\nfunc (engine *Engine) Run(addr ...string) (err error) {\n}\n\n"
        "// New returns a blank Engine.\nfunc New() *Engine {\n}\n\nfunc helper() {}\n",
        "example_test.go": "package gin_test\n\nfunc ExampleNew() {\n\tr := gin.New()\n\t_ = r\n}\n",
    }
    md = go_to_markdown("github.com/gin-gonic/gin", code_text)
    assert md.startswith("# package gin\n\nimport \"github.com/gin-gonic/gin\"\n\nPackage gin is a web framework.")
    assert "## func New() *Engine" in md and "New returns a blank Engine." in md
    assert "#### ExampleNew" in md and "r := gin.New()" in md
    assert "## type Engine struct" in md
    assert "### func (engine *Engine) Run(addr ...string) (err error)" in md and "Deprecated: use RunTLS." in md
    assert "helper" not in md


def test_go_packages_skip_internal_and_test_only_folders():
    files = {
        "m@v1.0.0/a.go": b"package m\nfunc A() {}\n",
        "m@v1.0.0/sub/b.go": b"package sub\nfunc B() {}\n",
        "m@v1.0.0/internal/c.go": b"package c\nfunc C() {}\n",
        "m@v1.0.0/only/x_test.go": b"package only\n",
    }
    assert sorted(go_packages("example.com/m", files, "m@v1.0.0/")) == ["root.md", "sub.md"]


def test_rustdoc_to_markdown_by_module_with_features_methods_and_deprecated():
    data = {
        "index": {
            "1": {"crate_id": 0, "name": "Serialize", "docs": "A data structure that can be serialized.", "attrs": ['#[doc(cfg(feature = "derive"))]'], "inner": {"trait": {}}},
            "2": {"crate_id": 0, "name": "Value", "docs": "Any JSON value.", "inner": {"enum": {"impls": [3]}}},
            "3": {"crate_id": 0, "name": None, "inner": {"impl": {"trait": None, "items": [4]}}},
            "4": {"crate_id": 0, "name": "as_str", "docs": "If a string, returns it.", "deprecation": {"since": "1.2", "note": "use as_string"}, "inner": {"function": {}}},
            "5": {"crate_id": 1, "name": "Other", "inner": {"struct": {}}},
        },
        "paths": {"1": {"path": ["serde", "Serialize"]}, "2": {"path": ["serde", "value", "Value"]}, "5": {"path": ["core", "Other"]}},
    }
    md = rustdoc_to_markdown(data, "serde")
    assert sorted(md) == ["serde.md", "serde/value.md"]
    assert "## trait `serde::Serialize`" in md["serde.md"] and "Available on crate feature derive only." in md["serde.md"]
    assert "### method `Value::as_str`" in md["serde/value.md"] and "Deprecated since 1.2: use as_string" in md["serde/value.md"]
    assert "Other" not in "".join(md.values())


def test_runtime_python_only_takes_reference_pages():
    url = "https://docs.python.org/3.13/archives/python-3.13-docs-html.zip"
    zipped = zip_with({
        "python-3.13-docs-html/library/os.html": "<h1>os</h1>",
        "python-3.13-docs-html/library/index.html": "<h1>Library</h1>",
        "python-3.13-docs-html/genindex.html": "<h1>Index</h1>",
        "python-3.13-docs-html/whatsnew/3.13.html": "<h1>New</h1>",
        "python-3.13-docs-html/whatsnew/3.12.html": "<h1>Old</h1>",
        "python-3.13-docs-html/_static/x.js": "x",
    })
    doc = fetch_docs("python", "runtime", "3.13.1", http=FakeHttp({url: zipped}))
    assert doc.reason is None and doc.hint == "sphinx"
    assert sorted(doc.files) == ["library/index.html", "library/os.html", "whatsnew/3.13.html"]


def test_npm_uses_the_repo_docs_at_the_published_commit():
    http = FakeHttp({
        "https://registry.npmjs.org/zustand/5.0.2": {"repository": {"url": "git+https://github.com/pmndrs/zustand.git"}, "gitHead": "abc123"},
        "https://api.github.com/repos/pmndrs/zustand/git/trees/abc123?recursive=1": {"tree": [{"type": "blob", "path": "docs/guides/slices.md"}]},
        "https://raw.githubusercontent.com/pmndrs/zustand/abc123/docs/guides/slices.md": "# Slices\n",
    })
    doc = fetch_docs("zustand", "npm", "5.0.2", http=http)
    assert doc.files == {"docs/guides/slices.md": "# Slices\n"}
    assert doc.origin == "https://github.com/pmndrs/zustand/tree/abc123"


def test_npm_without_repo_docs_uses_the_readme_and_warns():
    http = FakeHttp({
        "https://registry.npmjs.org/left-pad/1.3.0": {"repository": "https://github.com/a/left-pad"},
        "https://cdn.jsdelivr.net/npm/left-pad@1.3.0/README.md": "# left-pad\n",
    })
    doc = fetch_docs("left-pad", "npm", "1.3.0", http=http)
    assert doc.files == {"README.md": "# left-pad\n"} and doc.hint == "markdown"
    assert doc.warnings and "README" in doc.warnings[0]


def test_pypi_prefers_read_the_docs_and_falls_back_to_the_readme():
    zipped = zip_with({"requests-2.32.3/api.html": "<h1>API</h1>", "requests-2.32.3/genindex.html": "x"})
    http = FakeHttp({
        "https://pypi.org/pypi/requests/2.32.3/json": {"info": {"project_urls": {"Documentation": "https://requests.readthedocs.io"}}},
        "https://requests.readthedocs.io/_/downloads/en/2.32.3/htmlzip/": zipped,
    })
    doc = fetch_docs("requests", "python", "2.32.3", http=http)
    assert sorted(doc.files) == ["api.html"] and doc.hint == "sphinx"
    http = FakeHttp({"https://pypi.org/pypi/tiny/1.0/json": {"info": {"description": "# Tiny\n", "description_content_type": "text/markdown"}}})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert doc.files == {"README.md": "# Tiny\n"}


def test_fetch_docs_never_raises_and_gives_the_reason():
    assert "no se publica" in fetch_docs("rust", "runtime", "1.80", http=FakeHttp({})).reason
    assert fetch_docs("nada", "npm", "1.0.0", http=FakeHttp({})).reason.startswith("npm no tiene nada 1.0.0")
    down = FakeHttp({"https://registry.npmjs.org/x/1.0.0": urllib.error.URLError("sin red")})
    assert fetch_docs("x", "npm", "1.0.0", http=down).reason.startswith("Error al descargar")
    assert "desconocido" in fetch_docs("x", "cobol", "1", http=FakeHttp({})).reason


def test_resolve_node_takes_the_newest_for_the_prefix():
    http = FakeHttp({"https://nodejs.org/dist/index.json": [{"version": "v22.11.0"}, {"version": "v22.10.0"}, {"version": "v20.18.0"}]})
    assert sources.resolve_node(http, "22") == "v22.11.0"
    assert sources.resolve_node(http, "20.18.0") == "v20.18.0"


def test_rust_crate_without_json_uses_the_crates_io_readme(monkeypatch):
    http = FakeHttp({"https://crates.io/api/v1/crates/tiny/0.1.0/readme": "<h1>tiny</h1>"})
    doc = fetch_docs("tiny", "rust", "0.1.0", http=http)
    assert doc.files == {"README.html": "<h1>tiny</h1>"} and doc.warnings
    monkeypatch.setattr(sources, "_decompress_zstd", lambda data: data)
    data = {"index": {"1": {"crate_id": 0, "name": "f", "inner": {"function": {}}}}, "paths": {"1": {"path": ["tiny", "f"]}}}
    http = FakeHttp({"https://docs.rs/crate/tiny/0.1.0/json": json.dumps(data)})
    doc = fetch_docs("tiny", "rust", "0.1.0", http=http)
    assert doc.hint == "rust" and "## fn `tiny::f`" in doc.files["tiny.md"]
