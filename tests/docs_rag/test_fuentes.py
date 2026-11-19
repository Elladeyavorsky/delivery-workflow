import json
import urllib.error

from falsos import HttpFalso, zip_de

from docs_rag import fuentes
from docs_rag.fuentes import documentar, go_a_markdown, paquetes_go, repo_github, rustdoc_a_markdown, rutas_documentacion


def test_repo_github_acepta_las_formas_habituales():
    assert repo_github("git+https://github.com/axios/axios.git") == ("axios", "axios")
    assert repo_github("https://github.com/pallets/flask/tree/main") == ("pallets", "flask")
    assert repo_github("git@github.com:vercel/next.js.git") == ("vercel", "next.js")
    assert repo_github("https://gitlab.com/a/b") is None


def test_rutas_documentacion_elige_carpetas_de_docs_y_respeta_monorepos():
    arbol = [
        {"type": "blob", "path": "docs/guide/intro.md"},
        {"type": "blob", "path": "docs/CHANGELOG.md"},
        {"type": "blob", "path": "src/index.ts"},
        {"type": "blob", "path": "README.md"},
        {"type": "blob", "path": "packages/core/docs/api.mdx"},
        {"type": "blob", "path": "packages/other/docs/api.mdx"},
        {"type": "tree", "path": "docs"},
    ]
    assert rutas_documentacion(arbol) == ["docs/guide/intro.md", "packages/core/docs/api.mdx", "packages/other/docs/api.mdx"]
    assert rutas_documentacion(arbol, "packages/core") == ["packages/core/docs/api.mdx"]


def test_go_a_markdown_genera_firmas_docs_metodos_y_ejemplos():
    codigo = {
        "gin.go": "// Package gin is a web framework.\npackage gin\n\n// Engine is the framework instance.\ntype Engine struct {\n}\n\n"
        "// Run attaches the router.\n// Deprecated: use RunTLS.\nfunc (engine *Engine) Run(addr ...string) (err error) {\n}\n\n"
        "// New returns a blank Engine.\nfunc New() *Engine {\n}\n\nfunc helper() {}\n",
        "example_test.go": "package gin_test\n\nfunc ExampleNew() {\n\tr := gin.New()\n\t_ = r\n}\n",
    }
    md = go_a_markdown("github.com/gin-gonic/gin", codigo)
    assert md.startswith("# package gin\n\nimport \"github.com/gin-gonic/gin\"\n\nPackage gin is a web framework.")
    assert "## func New() *Engine" in md and "New returns a blank Engine." in md
    assert "#### ExampleNew" in md and "r := gin.New()" in md
    assert "## type Engine struct" in md
    assert "### func (engine *Engine) Run(addr ...string) (err error)" in md and "Deprecated: use RunTLS." in md
    assert "helper" not in md


def test_paquetes_go_salta_internal_y_carpetas_solo_de_tests():
    ficheros = {
        "m@v1.0.0/a.go": b"package m\nfunc A() {}\n",
        "m@v1.0.0/sub/b.go": b"package sub\nfunc B() {}\n",
        "m@v1.0.0/internal/c.go": b"package c\nfunc C() {}\n",
        "m@v1.0.0/only/x_test.go": b"package only\n",
    }
    assert sorted(paquetes_go("example.com/m", ficheros, "m@v1.0.0/")) == ["root.md", "sub.md"]


def test_rustdoc_a_markdown_por_modulo_con_features_metodos_y_deprecated():
    datos = {
        "index": {
            "1": {"crate_id": 0, "name": "Serialize", "docs": "A data structure that can be serialized.", "attrs": ['#[doc(cfg(feature = "derive"))]'], "inner": {"trait": {}}},
            "2": {"crate_id": 0, "name": "Value", "docs": "Any JSON value.", "inner": {"enum": {"impls": [3]}}},
            "3": {"crate_id": 0, "name": None, "inner": {"impl": {"trait": None, "items": [4]}}},
            "4": {"crate_id": 0, "name": "as_str", "docs": "If a string, returns it.", "deprecation": {"since": "1.2", "note": "use as_string"}, "inner": {"function": {}}},
            "5": {"crate_id": 1, "name": "Other", "inner": {"struct": {}}},
        },
        "paths": {"1": {"path": ["serde", "Serialize"]}, "2": {"path": ["serde", "value", "Value"]}, "5": {"path": ["core", "Other"]}},
    }
    md = rustdoc_a_markdown(datos, "serde")
    assert sorted(md) == ["serde.md", "serde/value.md"]
    assert "## trait `serde::Serialize`" in md["serde.md"] and "Available on crate feature derive only." in md["serde.md"]
    assert "### method `Value::as_str`" in md["serde/value.md"] and "Deprecated since 1.2: use as_string" in md["serde/value.md"]
    assert "Other" not in "".join(md.values())


def test_runtime_python_solo_toma_las_paginas_de_referencia():
    url = "https://docs.python.org/3.13/archives/python-3.13-docs-html.zip"
    zipped = zip_de({
        "python-3.13-docs-html/library/os.html": "<h1>os</h1>",
        "python-3.13-docs-html/library/index.html": "<h1>Library</h1>",
        "python-3.13-docs-html/genindex.html": "<h1>Index</h1>",
        "python-3.13-docs-html/whatsnew/3.13.html": "<h1>New</h1>",
        "python-3.13-docs-html/whatsnew/3.12.html": "<h1>Old</h1>",
        "python-3.13-docs-html/_static/x.js": "x",
    })
    doc = documentar("python", "runtime", "3.13.1", http=HttpFalso({url: zipped}))
    assert doc.motivo is None and doc.pista == "sphinx"
    assert sorted(doc.ficheros) == ["library/index.html", "library/os.html", "whatsnew/3.13.html"]


def test_npm_usa_las_docs_del_repo_en_el_commit_publicado():
    http = HttpFalso({
        "https://registry.npmjs.org/zustand/5.0.2": {"repository": {"url": "git+https://github.com/pmndrs/zustand.git"}, "gitHead": "abc123"},
        "https://api.github.com/repos/pmndrs/zustand/git/trees/abc123?recursive=1": {"tree": [{"type": "blob", "path": "docs/guides/slices.md"}]},
        "https://raw.githubusercontent.com/pmndrs/zustand/abc123/docs/guides/slices.md": "# Slices\n",
    })
    doc = documentar("zustand", "npm", "5.0.2", http=http)
    assert doc.ficheros == {"docs/guides/slices.md": "# Slices\n"}
    assert doc.origen == "https://github.com/pmndrs/zustand/tree/abc123"


def test_npm_sin_docs_en_el_repo_usa_el_readme_y_avisa():
    http = HttpFalso({
        "https://registry.npmjs.org/left-pad/1.3.0": {"repository": "https://github.com/a/left-pad"},
        "https://cdn.jsdelivr.net/npm/left-pad@1.3.0/README.md": "# left-pad\n",
    })
    doc = documentar("left-pad", "npm", "1.3.0", http=http)
    assert doc.ficheros == {"README.md": "# left-pad\n"} and doc.pista == "markdown"
    assert doc.avisos and "README" in doc.avisos[0]


def test_pypi_prefiere_read_the_docs_y_cae_al_readme():
    zipped = zip_de({"requests-2.32.3/api.html": "<h1>API</h1>", "requests-2.32.3/genindex.html": "x"})
    http = HttpFalso({
        "https://pypi.org/pypi/requests/2.32.3/json": {"info": {"project_urls": {"Documentation": "https://requests.readthedocs.io"}}},
        "https://requests.readthedocs.io/_/downloads/en/2.32.3/htmlzip/": zipped,
    })
    doc = documentar("requests", "python", "2.32.3", http=http)
    assert sorted(doc.ficheros) == ["api.html"] and doc.pista == "sphinx"
    http = HttpFalso({"https://pypi.org/pypi/tiny/1.0/json": {"info": {"description": "# Tiny\n", "description_content_type": "text/markdown"}}})
    doc = documentar("tiny", "python", "1.0", http=http)
    assert doc.ficheros == {"README.md": "# Tiny\n"}


def test_documentar_nunca_lanza_y_explica_el_motivo():
    assert "no se publica" in documentar("rust", "runtime", "1.80", http=HttpFalso({})).motivo
    assert documentar("nada", "npm", "1.0.0", http=HttpFalso({})).motivo.startswith("npm no tiene nada 1.0.0")
    caido = HttpFalso({"https://registry.npmjs.org/x/1.0.0": urllib.error.URLError("sin red")})
    assert documentar("x", "npm", "1.0.0", http=caido).motivo.startswith("Error al descargar")
    assert "desconocido" in documentar("x", "cobol", "1", http=HttpFalso({})).motivo


def test_resolver_node_toma_la_mas_nueva_del_prefijo():
    http = HttpFalso({"https://nodejs.org/dist/index.json": [{"version": "v22.11.0"}, {"version": "v22.10.0"}, {"version": "v20.18.0"}]})
    assert fuentes.resolver_node(http, "22") == "v22.11.0"
    assert fuentes.resolver_node(http, "20.18.0") == "v20.18.0"


def test_crate_rust_sin_json_usa_el_readme_de_crates_io(monkeypatch):
    http = HttpFalso({"https://crates.io/api/v1/crates/tiny/0.1.0/readme": "<h1>tiny</h1>"})
    doc = documentar("tiny", "rust", "0.1.0", http=http)
    assert doc.ficheros == {"README.html": "<h1>tiny</h1>"} and doc.avisos
    monkeypatch.setattr(fuentes, "_descomprimir_zstd", lambda datos: datos)
    datos = {"index": {"1": {"crate_id": 0, "name": "f", "inner": {"function": {}}}}, "paths": {"1": {"path": ["tiny", "f"]}}}
    http = HttpFalso({"https://docs.rs/crate/tiny/0.1.0/json": json.dumps(datos)})
    doc = documentar("tiny", "rust", "0.1.0", http=http)
    assert doc.pista == "rust" and "## fn `tiny::f`" in doc.ficheros["tiny.md"]
