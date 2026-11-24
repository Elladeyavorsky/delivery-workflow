import io
import json
import urllib.error
import urllib.parse

from fakes import FakeHttp, zip_with

from docs_rag import sources
from docs_rag.sources import RepoRemote, fetch_docs, go_to_markdown, go_packages, docs_from_repo, github_repo, parse_remote, pick_repo_url, rustdoc_to_markdown, doc_paths


def test_github_repo_accepts_the_usual_forms():
    assert github_repo("git+https://github.com/axios/axios.git") == ("axios", "axios")
    assert github_repo("https://github.com/pallets/flask/tree/main") == ("pallets", "flask")
    assert github_repo("git@github.com:vercel/next.js.git") == ("vercel", "next.js")
    assert github_repo("https://gitlab.com/a/b") is None


def test_github_repo_accepts_a_port_and_the_scp_form():
    assert github_repo("https://github.com:443/a/b") == ("a", "b")
    assert github_repo("https://github.com:443/a/b.git") == ("a", "b")
    assert github_repo("git@github.com:a/b.git") == ("a", "b")
    assert github_repo("https://gitlab.com:443/a/b") is None


def test_docs_from_repo_with_a_github_url_with_port_asks_for_the_right_repo():
    http = FakeHttp({
        "https://api.github.com/repos/a/b/git/trees/v1?recursive=1": {"tree": [{"type": "blob", "path": "docs/guia.md"}]},
        "https://raw.githubusercontent.com/a/b/v1/docs/guia.md": GUIDE,
    })
    doc = docs_from_repo(http, "https://github.com:443/a/b", ["v1"])
    assert doc.files == {"docs/guia.md": GUIDE}
    assert doc.origin == "https://github.com/a/b/tree/v1"
    assert http.requested_keys[0] == "https://api.github.com/repos/a/b/git/trees/v1?recursive=1"


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


def test_parse_remote_forms():
    assert parse_remote("https://gitlab.com/grupo/repo") == RepoRemote("gitlab", "gitlab.com", "grupo/repo")
    assert parse_remote("gitlab:grupo/repo") == RepoRemote("gitlab", "gitlab.com", "grupo/repo")
    assert parse_remote("git+https://gitlab.com/grupo/repo.git") == RepoRemote("gitlab", "gitlab.com", "grupo/repo")
    assert parse_remote("git://gitlab.com/grupo/repo.git") == RepoRemote("gitlab", "gitlab.com", "grupo/repo")
    assert parse_remote("ssh://git@gitlab.com/grupo/repo.git") == RepoRemote("gitlab", "gitlab.com", "grupo/repo")
    assert parse_remote("git@gitlab.com:grupo/repo.git") == RepoRemote("gitlab", "gitlab.com", "grupo/repo")
    # GitLab conserva los subgrupos y corta en los marcadores de página.
    assert parse_remote("https://gitlab.com/grupo/subgrupo/repo/").path == "grupo/subgrupo/repo"
    assert parse_remote("https://gitlab.com/grupo/subgrupo/repo/-/tree/main/docs").path == "grupo/subgrupo/repo"
    for marker in ("tree/main", "blob/main/a.md", "issues", "merge_requests", "wikis", "releases"):
        assert parse_remote(f"https://gitlab.com/grupo/repo/{marker}").path == "grupo/repo"
    assert parse_remote("https://gitlab.com/grupo/repo?ref=x#readme").path == "grupo/repo"
    # Gitea y Bitbucket se quedan con dos segmentos.
    assert parse_remote("https://codeberg.org/dueño/repo/src/branch/main") == RepoRemote("gitea", "codeberg.org", "dueño/repo")
    assert parse_remote("https://bitbucket.org/ws/repo/src/main/") == RepoRemote("bitbucket", "bitbucket.org", "ws/repo")
    assert parse_remote("https://github.com/pallets/flask/tree/main") == RepoRemote("github", "github.com", "pallets/flask")
    # Remoto git de otro host: desconocido solo si es un remoto git.
    assert parse_remote("https://gitlab.empresa.com/grupo/repo.git") == RepoRemote("unknown", "gitlab.empresa.com", "grupo/repo")
    assert parse_remote("git@git.empresa.com:grupo/repo.git") == RepoRemote("unknown", "git.empresa.com", "grupo/repo")
    assert parse_remote("git+https://git.empresa.com/grupo/repo") == RepoRemote("unknown", "git.empresa.com", "grupo/repo")
    assert parse_remote("ssh://git@git.empresa.com/grupo/repo") == RepoRemote("unknown", "git.empresa.com", "grupo/repo")
    # No son repositorio.
    assert parse_remote("https://sr.ht/~u/repo") is None
    assert parse_remote("https://docs.ejemplo.dev/guia") is None
    assert parse_remote("") is None
    assert parse_remote(None) is None
    assert parse_remote("https://") is None
    assert parse_remote("https://gitlab.com/solo") is None
    assert parse_remote("https://codeberg.org/solo") is None
    assert parse_remote("https://bitbucket.org/ws") is None


def test_parse_remote_segment_cut_and_port():
    assert parse_remote("https://gitlab.com/g/issues-app") == RepoRemote("gitlab", "gitlab.com", "g/issues-app")
    assert parse_remote("https://gitlab.com/g/repo/issues") == RepoRemote("gitlab", "gitlab.com", "g/repo")
    assert parse_remote("https://gitlab.com/g/repo/issues/3") == RepoRemote("gitlab", "gitlab.com", "g/repo")
    assert parse_remote("https://gitlab.com/g/repo/-/tree/main") == RepoRemote("gitlab", "gitlab.com", "g/repo")

    assert parse_remote("https://host:8080/g/r.git") == RepoRemote("unknown", "host:8080", "g/r")
    assert parse_remote("git+https://h:81/g/r.git") == RepoRemote("unknown", "h:81", "g/r")
    assert parse_remote("git+https://host:8443/g/r.git") == RepoRemote("unknown", "host:8443", "g/r")
    assert parse_remote("ssh://git@host:2222/g/r.git") == RepoRemote("unknown", "host", "g/r")
    assert parse_remote("git://h:9418/g/r.git") == RepoRemote("unknown", "h", "g/r")
    assert parse_remote("git://host:9418/g/r.git") == RepoRemote("unknown", "host", "g/r")

    # El forge se busca por el host sin el puerto; el puerto se conserva en host solo con http(s).
    assert parse_remote("https://gitlab.com:8443/g/r.git") == RepoRemote("gitlab", "gitlab.com:8443", "g/r")
    assert parse_remote("https://github.com:443/a/b") == RepoRemote("github", "github.com:443", "a/b")
    assert parse_remote("https://codeberg.org:443/d/r").kind == "gitea"
    assert parse_remote("https://bitbucket.org:443/w/r").kind == "bitbucket"
    ssh = parse_remote("ssh://git@gitlab.com:2222/g/r.git")
    assert ssh == RepoRemote("gitlab", "gitlab.com", "g/r") and ":" not in ssh.host


def test_pick_repo_url_prefers_known_forges():
    urls = ["https://docs.ejemplo.dev", "https://git.empresa.com/g/r.git", "https://codeberg.org/d/r", "https://github.com/a/b"]
    assert pick_repo_url(urls) == "https://codeberg.org/d/r"
    assert pick_repo_url(["https://docs.ejemplo.dev", "https://git.empresa.com/g/r.git", "git@otro.com:g/r.git"]) == "https://git.empresa.com/g/r.git"
    assert pick_repo_url(["https://docs.ejemplo.dev", "", "https://sr.ht/~u/repo"]) is None
    assert pick_repo_url([]) is None


def test_download_respects_file_and_byte_limits_and_skips_failures(monkeypatch):
    def fetch(file_path):
        if file_path == "roto.md":
            raise urllib.error.HTTPError(file_path, 500, "Error", {}, None)
        return b"x" * 10

    assert sources._download(fetch, ["a.md", "roto.md", "b.md"]) == {"a.md": "x" * 10, "b.md": "x" * 10}
    monkeypatch.setattr(sources, "MAX_FILES", 2)
    assert list(sources._download(fetch, ["a.md", "b.md", "c.md"])) == ["a.md", "b.md"]
    monkeypatch.setattr(sources, "MAX_FILES", 3000)
    monkeypatch.setattr(sources, "MAX_BYTES", 25)
    assert list(sources._download(fetch, ["a.md", "b.md", "c.md", "d.md"])) == ["a.md", "b.md"]


# --- Forges distintos de GitHub: GitLab, Gitea/Forgejo y Bitbucket Cloud ---

GUIDE = "# Guía\n"
PYPI_1_0 = "https://pypi.org/pypi/tiny/1.0/json"


def pypi_with_repo(repo_url, **extra):
    return {PYPI_1_0: {"info": {"project_urls": {"Source": repo_url}, **extra}}}


def gitlab_urls(host, path, ref, entries, files, page=1):
    project = f"https://{host}/api/v4/projects/{path.replace('/', '%2F')}"
    out = {f"{project}/repository/tree?ref={ref}&recursive=true&per_page=100&page={page}": entries}
    out.update({f"{project}/repository/files/{p.replace('/', '%2F')}/raw?ref={ref}": t for p, t in files.items()})
    return out


def gitea_urls(host, path, ref, entries, files, page=1, truncated=False):
    api = f"https://{host}/api/v1/repos/{urllib.parse.quote(path)}"
    out = {f"{api}/git/trees/{ref}?recursive=true&page={page}": {"tree": entries, "truncated": truncated}}
    out.update({f"{api}/raw/{p}?ref={ref}": t for p, t in files.items()})
    return out


def bitbucket_urls(path, ref, entries, files, next_url=None):
    api = f"https://api.bitbucket.org/2.0/repositories/{path}"
    page = {"values": entries}
    if next_url:
        page["next"] = next_url
    out = {f"{api}/src/{ref}/?max_depth=10&pagelen=100": page}
    out.update({f"{api}/src/{ref}/{p}": t for p, t in files.items()})
    return out


GUIDE_BLOB = [{"type": "blob", "path": "docs/guia.md"}, {"type": "blob", "path": "src/main.py"}]
GUIDE_FILE = {"docs/guia.md": GUIDE}


def test_pypi_uses_gitlab_repo_docs_at_the_tag():
    http = FakeHttp({**pypi_with_repo("https://gitlab.com/grupo/repo", description="# README de PyPI\n"), **gitlab_urls("gitlab.com", "grupo/repo", "v1.0", GUIDE_BLOB, GUIDE_FILE)})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert doc.files == {"docs/guia.md": GUIDE}
    assert doc.origin == "https://gitlab.com/grupo/repo/-/tree/v1.0"
    assert "README.md" not in doc.files and not doc.warnings


def test_pypi_uses_codeberg_repo_docs_through_gitea():
    entries = [{"type": "blob", "path": "docs/guia.md"}, {"type": "tree", "path": "docs"}]
    http = FakeHttp({**pypi_with_repo("https://codeberg.org/dueño/repo"), **gitea_urls("codeberg.org", "dueño/repo", "v1.0", entries, GUIDE_FILE)})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert doc.files == {"docs/guia.md": GUIDE}
    assert doc.origin == "https://codeberg.org/dueño/repo/src/tag/v1.0"
    assert any("/api/v1/repos/" in u for u in http.requested_keys)


def test_gitea_origin_uses_commit_for_a_full_hash():
    forge = sources.GiteaForge("codeberg.org", "d/r")
    assert forge.origin("a" * 40) == f"https://codeberg.org/d/r/src/commit/{'a' * 40}"
    assert forge.origin("v1.0") == "https://codeberg.org/d/r/src/tag/v1.0"


def test_pypi_uses_bitbucket_repo_docs():
    entries = [{"type": "commit_file", "path": "docs/guia.md"}, {"type": "commit_directory", "path": "docs"}, {"type": "commit_file", "path": "src/main.py"}]
    http = FakeHttp({**pypi_with_repo("https://bitbucket.org/ws/repo"), **bitbucket_urls("ws/repo", "v1.0", entries, GUIDE_FILE)})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert doc.files == {"docs/guia.md": GUIDE}
    assert doc.origin == "https://bitbucket.org/ws/repo/src/v1.0"


def test_npm_gitlab_shorthand_and_git_plus_https():
    for repository in ("gitlab:grupo/repo", "git+https://gitlab.com/grupo/repo.git", {"url": "gitlab:grupo/repo"}):
        http = FakeHttp({
            "https://registry.npmjs.org/pkg/2.0.0": {"repository": repository, "gitHead": "abc123"},
            **gitlab_urls("gitlab.com", "grupo/repo", "abc123", GUIDE_BLOB, GUIDE_FILE),
        })
        doc = fetch_docs("pkg", "npm", "2.0.0", http=http)
        assert doc.files == {"docs/guia.md": GUIDE}, repository
        assert doc.origin == "https://gitlab.com/grupo/repo/-/tree/abc123", repository


def test_unknown_git_remote_tries_gitlab_first():
    http = FakeHttp({**pypi_with_repo("https://gitlab.empresa.com/grupo/repo.git"), **gitlab_urls("gitlab.empresa.com", "grupo/repo", "v1.0", GUIDE_BLOB, GUIDE_FILE)})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert doc.files == {"docs/guia.md": GUIDE}
    assert doc.origin == "https://gitlab.empresa.com/grupo/repo/-/tree/v1.0"
    assert not any("/api/v1/" in u for u in http.requested_keys)


def test_docs_from_repo_with_a_port_sends_every_request_to_that_port():
    http = FakeHttp(gitlab_urls("host:8080", "g/r", "v1.0", GUIDE_BLOB, GUIDE_FILE))
    doc = docs_from_repo(http, "https://host:8080/g/r.git", ["v1.0"])
    assert doc.files == {"docs/guia.md": GUIDE}
    assert doc.origin == "https://host:8080/g/r/-/tree/v1.0"
    assert http.requested_keys and all(u.startswith("https://host:8080/") for u in http.requested_keys)


def test_unknown_git_remote_falls_back_to_gitea():
    http = FakeHttp({**pypi_with_repo("https://git.empresa.com/grupo/repo.git"), **gitea_urls("git.empresa.com", "grupo/repo", "v1.0", GUIDE_BLOB, GUIDE_FILE)})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert doc.files == {"docs/guia.md": GUIDE}
    assert doc.origin == "https://git.empresa.com/grupo/repo/src/tag/v1.0"
    assert any("/api/v4/" in u for u in http.requested_keys)


def test_unknown_git_remote_without_api_keeps_the_readme_path():
    pypi = FakeHttp(pypi_with_repo("https://git.empresa.com/grupo/repo.git", description="# Tiny\n", description_content_type="text/markdown"))
    doc = fetch_docs("tiny", "python", "1.0", http=pypi)
    assert doc.files == {"README.md": "# Tiny\n"} and "README de PyPI" in doc.warnings[0]
    assert any("git.empresa.com/api/v4/" in u for u in pypi.requested_keys)

    npm = FakeHttp({
        "https://registry.npmjs.org/pkg/2.0.0": {"repository": "git+https://git.empresa.com/grupo/repo.git"},
        "https://cdn.jsdelivr.net/npm/pkg@2.0.0/README.md": "# pkg\n",
    })
    doc = fetch_docs("pkg", "npm", "2.0.0", http=npm)
    assert doc.files == {"README.md": "# pkg\n"} and doc.warnings

    sin_readme = FakeHttp(pypi_with_repo("https://git.empresa.com/grupo/repo.git"))
    doc = fetch_docs("tiny", "python", "1.0", http=sin_readme)
    assert not doc.files and doc.reason


def test_unsupported_hosts_and_non_remote_urls_make_no_requests():
    for repo_url in ("https://sr.ht/~u/repo", "https://docs.ejemplo.dev/guia"):
        http = FakeHttp(pypi_with_repo(repo_url, description="# Tiny\n", description_content_type="text/markdown"))
        doc = fetch_docs("tiny", "python", "1.0", http=http)
        assert doc.files == {"README.md": "# Tiny\n"}
        assert http.requested_keys == [PYPI_1_0], repo_url
    npm = FakeHttp({
        "https://registry.npmjs.org/pkg/2.0.0": {"repository": "https://docs.ejemplo.dev/guia"},
        "https://cdn.jsdelivr.net/npm/pkg@2.0.0/README.md": "# pkg\n",
    })
    fetch_docs("pkg", "npm", "2.0.0", http=npm)
    assert all("ejemplo.dev" not in u for u in npm.requested_keys)


def test_forge_trees_respect_file_and_byte_limits(monkeypatch):
    # Más de 3000 ficheros de documentación en GitLab: 3000 como mucho y no se pide la página 31.
    pages = {}
    files = {}
    for page in range(1, 41):
        entries = [{"type": "blob", "path": f"docs/f{(page - 1) * 100 + i:04d}.md"} for i in range(100)]
        pages.update(gitlab_urls("gitlab.com", "g/r", "v1.0", entries, {}, page=page))
        files.update({e["path"]: "x" for e in entries})
    pages.update(gitlab_urls("gitlab.com", "g/r", "v1.0", [], files, page=999))
    http = FakeHttp({**pypi_with_repo("https://gitlab.com/g/r"), **pages})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert len(doc.files) == 3000
    tree_pages = [u for u in http.requested_keys if "/repository/tree?" in u]
    assert len(tree_pages) == 30 and not any(u.endswith("page=31") for u in tree_pages)

    # Más de MAX_BYTES en Gitea: se para de descargar al pasar el tope.
    monkeypatch.setattr(sources, "MAX_BYTES", 25)
    entries = [{"type": "blob", "path": f"docs/{n}.md"} for n in "abcd"]
    http = FakeHttp({**pypi_with_repo("https://codeberg.org/d/r"), **gitea_urls("codeberg.org", "d/r", "v1.0", entries, {f"docs/{n}.md": "x" * 10 for n in "abcd"})})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert sorted(doc.files) == ["docs/a.md", "docs/b.md"]
    assert not any(u.endswith("docs/d.md?ref=v1.0") for u in http.requested_keys)


def test_forge_tree_pagination():
    def entries(first, count):
        return [{"type": "blob", "path": first}] + [{"type": "blob", "path": f"src/{first}{i}.py"} for i in range(count - 1)]

    # GitLab: página de 100 entradas y otra de 20; no pide una tercera.
    gl = {**pypi_with_repo("https://gitlab.com/g/r"),
          **gitlab_urls("gitlab.com", "g/r", "v1.0", entries("docs/a.md", 100), {"docs/a.md": "A"}, page=1),
          **gitlab_urls("gitlab.com", "g/r", "v1.0", entries("docs/b.md", 20), {"docs/b.md": "B"}, page=2)}
    http = FakeHttp(gl)
    assert fetch_docs("tiny", "python", "1.0", http=http).files == {"docs/a.md": "A", "docs/b.md": "B"}
    assert not any(u.endswith("page=3") for u in http.requested_keys)

    # Gitea: truncated true en la 1 y false en la 2.
    gt = {**pypi_with_repo("https://codeberg.org/d/r"),
          **gitea_urls("codeberg.org", "d/r", "v1.0", [{"type": "blob", "path": "docs/a.md"}], {"docs/a.md": "A"}, page=1, truncated=True),
          **gitea_urls("codeberg.org", "d/r", "v1.0", [{"type": "blob", "path": "docs/b.md"}], {"docs/b.md": "B"}, page=2, truncated=False)}
    http = FakeHttp(gt)
    assert fetch_docs("tiny", "python", "1.0", http=http).files == {"docs/a.md": "A", "docs/b.md": "B"}
    assert not any("page=3" in u for u in http.requested_keys)

    # Bitbucket: `next` en la primera página.
    api = "https://api.bitbucket.org/2.0/repositories/ws/r"
    next_url = f"{api}/src/v1.0/?max_depth=10&pagelen=100&page=2"
    bb = {**pypi_with_repo("https://bitbucket.org/ws/r"),
          **bitbucket_urls("ws/r", "v1.0", [{"type": "commit_file", "path": "docs/a.md"}], {"docs/a.md": "A", "docs/b.md": "B"}, next_url=next_url),
          next_url: {"values": [{"type": "commit_file", "path": "docs/b.md"}]}}
    http = FakeHttp(bb)
    assert fetch_docs("tiny", "python", "1.0", http=http).files == {"docs/a.md": "A", "docs/b.md": "B"}


def test_gitlab_encodes_the_full_path():
    http = FakeHttp({
        **pypi_with_repo("https://gitlab.com/grupo/subgrupo/repo"),
        **gitlab_urls("gitlab.com", "grupo/subgrupo/repo", "v1.0", [{"type": "blob", "path": "docs/sub/guia.md"}], {"docs/sub/guia.md": GUIDE}),
    })
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert doc.files == {"docs/sub/guia.md": GUIDE}
    assert doc.origin == "https://gitlab.com/grupo/subgrupo/repo/-/tree/v1.0"
    assert "https://gitlab.com/api/v4/projects/grupo%2Fsubgrupo%2Frepo/repository/tree?ref=v1.0&recursive=true&per_page=100&page=1" in http.requested_keys
    assert "https://gitlab.com/api/v4/projects/grupo%2Fsubgrupo%2Frepo/repository/files/docs%2Fsub%2Fguia.md/raw?ref=v1.0" in http.requested_keys


def test_token_is_sent_only_to_github():
    cases = {
        "https://gitlab.com/grupo/repo": gitlab_urls("gitlab.com", "grupo/repo", "v1.0", GUIDE_BLOB, GUIDE_FILE),
        "https://codeberg.org/d/repo": gitea_urls("codeberg.org", "d/repo", "v1.0", GUIDE_BLOB, GUIDE_FILE),
        "https://bitbucket.org/ws/repo": bitbucket_urls("ws/repo", "v1.0", [{"type": "commit_file", "path": "docs/guia.md"}], GUIDE_FILE),
    }
    for repo_url, urls in cases.items():
        http = FakeHttp({**pypi_with_repo(repo_url), **urls})
        assert fetch_docs("tiny", "python", "1.0", http=http, token="secreto").files == {"docs/guia.md": GUIDE}, repo_url
        assert len(http.requested_headers) > 2
        assert not any("Authorization" in h for h in http.requested_headers), repo_url

    github = FakeHttp({
        **pypi_with_repo("https://github.com/a/b"),
        "https://api.github.com/repos/a/b/git/trees/v1.0?recursive=1": {"tree": GUIDE_BLOB},
        "https://raw.githubusercontent.com/a/b/v1.0/docs/guia.md": GUIDE,
    })
    assert fetch_docs("tiny", "python", "1.0", http=github, token="secreto").files == {"docs/guia.md": GUIDE}
    sent = {u: h for u, h in zip(github.requested_keys, github.requested_headers) if "github" in u}
    assert len(sent) == 2 and all(h.get("Authorization") == "Bearer secreto" for h in sent.values())


# --- Casos de borde y errores (CB-01 a CB-08) ---


def http_error(code):
    return urllib.error.HTTPError("https://x", code, "err", {}, None)


def test_forge_errors_mean_api_missing():
    # CB-01: en un forge conocido, 404, 401, 403 y una respuesta no JSON del primer ref pasan al siguiente ref.
    for gitlab_failure in (http_error(404), http_error(401), http_error(403), "<html>login</html>"):
        v1 = "https://gitlab.com/api/v4/projects/g%2Fr/repository/tree?ref=v1.0&recursive=true&per_page=100&page=1"
        http = FakeHttp({**pypi_with_repo("https://gitlab.com/g/r"), v1: gitlab_failure, **gitlab_urls("gitlab.com", "g/r", "1.0", GUIDE_BLOB, GUIDE_FILE)})
        doc = fetch_docs("tiny", "python", "1.0", http=http)
        assert doc.files == {"docs/guia.md": GUIDE}, gitlab_failure
        assert doc.origin == "https://gitlab.com/g/r/-/tree/1.0"
    for gitea_failure in (http_error(404), http_error(401), http_error(403), "<html>login</html>"):
        v1 = "https://codeberg.org/api/v1/repos/d/r/git/trees/v1.0?recursive=true&page=1"
        http = FakeHttp({**pypi_with_repo("https://codeberg.org/d/r"), v1: gitea_failure, **gitea_urls("codeberg.org", "d/r", "1.0", GUIDE_BLOB, GUIDE_FILE)})
        assert fetch_docs("tiny", "python", "1.0", http=http).files == {"docs/guia.md": GUIDE}, gitea_failure

    # Gitea y Forgejo (Codeberg) responden 400 `sha not found` a un ref que no existe: en la primera página pasa al siguiente ref.
    v1 = "https://codeberg.org/api/v1/repos/d/r/git/trees/v1.27.0?recursive=true&page=1"
    sha_not_found = urllib.error.HTTPError("https://x", 400, "Bad Request", {}, io.BytesIO(b'{"message":"sha not found [v1.27.0]"}'))
    pypi = {PYPI_1_0.replace("/1.0/", "/1.27.0/"): pypi_with_repo("https://codeberg.org/d/r")[PYPI_1_0]}
    http = FakeHttp({**pypi, v1: sha_not_found, **gitea_urls("codeberg.org", "d/r", "1.27.0", GUIDE_BLOB, GUIDE_FILE)})
    doc = fetch_docs("tiny", "python", "1.27.0", http=http)
    assert doc.files == {"docs/guia.md": GUIDE} and not doc.reason
    assert doc.origin == "https://codeberg.org/d/r/src/tag/1.27.0"
    assert v1 in http.requested_keys

    # El 400 solo es «no existe» en Gitea: en GitLab y en Bitbucket se propaga como reason.
    gl = "https://gitlab.com/api/v4/projects/g%2Fr/repository/tree?ref=v1.0&recursive=true&per_page=100&page=1"
    http = FakeHttp({**pypi_with_repo("https://gitlab.com/g/r", description="# Tiny\n"), gl: http_error(400), **gitlab_urls("gitlab.com", "g/r", "1.0", GUIDE_BLOB, GUIDE_FILE)})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert not doc.files and doc.reason.startswith("Error al descargar")
    assert not any("ref=1.0" in u for u in http.requested_keys)
    bb = "https://api.bitbucket.org/2.0/repositories/ws/r/src/v1.0/?max_depth=10&pagelen=100"
    http = FakeHttp({**pypi_with_repo("https://bitbucket.org/ws/r", description="# Tiny\n"), bb: http_error(400), **bitbucket_urls("ws/r", "1.0", GUIDE_BLOB, GUIDE_FILE)})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert not doc.files and doc.reason.startswith("Error al descargar")
    assert not any("/src/1.0/" in u for u in http.requested_keys)

    # CB-01: cualquier otro código HTTP, y un fallo de red, se propaga y fetch_docs lo devuelve como reason.
    v1 = "https://gitlab.com/api/v4/projects/g%2Fr/repository/tree?ref=v1.0&recursive=true&per_page=100&page=1"
    for failure in (http_error(500), http_error(429), urllib.error.URLError("sin red")):
        http = FakeHttp({**pypi_with_repo("https://gitlab.com/g/r", description="# Tiny\n"), v1: failure})
        doc = fetch_docs("tiny", "python", "1.0", http=http)
        assert not doc.files and doc.reason.startswith("Error al descargar"), failure

    # CB-02: en un remoto desconocido, HTTPError, URLError y no JSON del sondeo son «esa API no existe».
    gl = "https://git.empresa.com/api/v4/projects/g%2Fr/repository/tree?ref=v1.0&recursive=true&per_page=100&page=1"
    for probe_failure in (http_error(500), http_error(404), urllib.error.URLError("sin red"), "<html>login</html>"):
        http = FakeHttp({**pypi_with_repo("https://git.empresa.com/g/r.git"), gl: probe_failure, **gitea_urls("git.empresa.com", "g/r", "v1.0", GUIDE_BLOB, GUIDE_FILE)})
        doc = fetch_docs("tiny", "python", "1.0", http=http)
        assert doc.files == {"docs/guia.md": GUIDE} and not doc.reason, probe_failure
        readme = FakeHttp({**pypi_with_repo("https://git.empresa.com/g/r.git", description="# Tiny\n", description_content_type="text/markdown"),
                           **{f"https://git.empresa.com/api/v4/projects/g%2Fr/repository/tree?ref={r}&recursive=true&per_page=100&page=1": probe_failure for r in ("v1.0", "1.0", "tiny-1.0", "release-1.0", "tiny%401.0")}})
        doc = fetch_docs("tiny", "python", "1.0", http=readme)
        assert doc.files == {"README.md": "# Tiny\n"} and not doc.reason, probe_failure


def test_a_file_that_fails_is_skipped_and_without_files_there_are_no_docs():
    # CB-03: un fichero que falla se salta; si no queda ninguno, se sigue con el README.
    entries = [{"type": "blob", "path": "docs/a.md"}, {"type": "blob", "path": "docs/roto.md"}]
    http = FakeHttp({**pypi_with_repo("https://gitlab.com/g/r"), **gitlab_urls("gitlab.com", "g/r", "v1.0", entries, {"docs/a.md": "A"})})
    assert fetch_docs("tiny", "python", "1.0", http=http).files == {"docs/a.md": "A"}
    http = FakeHttp({**pypi_with_repo("https://gitlab.com/g/r", description="# Tiny\n", description_content_type="text/markdown"),
                     **gitlab_urls("gitlab.com", "g/r", "v1.0", entries, {})})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert doc.files == {"README.md": "# Tiny\n"} and doc.warnings
    assert sources.docs_from_repo(http, "https://gitlab.com/g/r", ["v1.0"]) is None


def test_bitbucket_follows_next_only_on_its_api_host_and_later_failures_propagate():
    api = "https://api.bitbucket.org/2.0/repositories/ws/r"
    entry = [{"type": "commit_file", "path": "docs/a.md"}]
    # CB-04: un `next` a otro host corta la paginación y no se pide.
    other = "https://evil.example/2.0/repositories/ws/r/src/v1.0/?page=2"
    http = FakeHttp({**pypi_with_repo("https://bitbucket.org/ws/r"), **bitbucket_urls("ws/r", "v1.0", entry, {"docs/a.md": "A", "docs/b.md": "B"}, next_url=other),
                     other: {"values": [{"type": "commit_file", "path": "docs/b.md"}]}})
    assert fetch_docs("tiny", "python", "1.0", http=http).files == {"docs/a.md": "A"}
    assert other not in http.requested_keys

    # CB-04: un 404 en la primera página es «ref inexistente»: pasa al siguiente ref.
    http = FakeHttp({**pypi_with_repo("https://bitbucket.org/ws/r"), **bitbucket_urls("ws/r", "1.0", entry, {"docs/a.md": "A"})})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert doc.files == {"docs/a.md": "A"} and doc.origin == "https://bitbucket.org/ws/r/src/1.0"
    assert f"{api}/src/v1.0/?max_depth=10&pagelen=100" in http.requested_keys

    # CB-04: un fallo en una página posterior se propaga como reason, también un 404.
    second = f"{api}/src/v1.0/?max_depth=10&pagelen=100&page=2"
    for failure in (None, http_error(500)):
        responses = {**pypi_with_repo("https://bitbucket.org/ws/r"), **bitbucket_urls("ws/r", "v1.0", entry, {"docs/a.md": "A"}, next_url=second)}
        if failure:
            responses[second] = failure
        doc = fetch_docs("tiny", "python", "1.0", http=FakeHttp(responses))
        assert not doc.files and doc.reason.startswith("Error al descargar"), failure


def test_a_tree_without_documentation_returns_none_without_trying_another_adapter():
    # CB-05: ref existente con árbol vacío o sin documentación: None, sin pasar a Gitea.
    for tree in ([], [{"type": "blob", "path": "src/main.py"}]):
        http = FakeHttp(gitlab_urls("git.empresa.com", "g/r", "v1.0", tree, {}))
        assert sources.docs_from_repo(http, "https://git.empresa.com/g/r.git", ["v1.0", "1.0"]) is None
        assert not any("/api/v1/" in u for u in http.requested_keys)
        assert not any("ref=1.0" in u or "/trees/1.0" in u for u in http.requested_keys)


def test_urls_that_are_not_a_repository_make_no_requests():
    # CB-06: vacía, None, sin host o con una ruta de un solo segmento en un forge de dos.
    http = FakeHttp({})
    for url in (None, "", "   ", "https:///g/r.git", "https://codeberg.org/solo", "https://bitbucket.org/ws", "https://codeberg.org/"):
        assert sources.docs_from_repo(http, url, ["v1.0"]) is None, url
    assert http.requested_keys == []


def test_monorepo_directory_without_docs_retries_without_base():
    # CB-07: sin documentación bajo `directory`, reintenta sin base.
    http = FakeHttp({
        "https://registry.npmjs.org/pkg/2.0.0": {"repository": {"url": "https://gitlab.com/g/r", "directory": "packages/a"}, "gitHead": "abc123"},
        **gitlab_urls("gitlab.com", "g/r", "abc123", GUIDE_BLOB, GUIDE_FILE),
    })
    doc = fetch_docs("pkg", "npm", "2.0.0", http=http)
    assert doc.files == {"docs/guia.md": GUIDE}
    assert sum("/repository/tree?" in u for u in http.requested_keys) == 2


def test_refs_and_paths_are_quoted_with_slash_as_percent_2f():
    # CB-08: un ref con `/` (`@scope/pkg@1.0`) va como %2F y `@` como %40.
    ref = "%40scope%2Fpkg%401.0"
    gl = "https://gitlab.com/api/v4/projects/g%2Fr"
    http = FakeHttp({
        f"{gl}/repository/tree?ref={ref}&recursive=true&per_page=100&page=1": GUIDE_BLOB,
        f"{gl}/repository/files/docs%2Fguia.md/raw?ref={ref}": GUIDE,
    })
    assert sources.docs_from_repo(http, "https://gitlab.com/g/r", ["@scope/pkg@1.0"]).files == {"docs/guia.md": GUIDE}

    gt = "https://codeberg.org/api/v1/repos/d/r"
    http = FakeHttp({
        f"{gt}/git/trees/{ref}?recursive=true&page=1": {"tree": [{"type": "blob", "path": "docs/mi guia.md"}]},
        f"{gt}/raw/docs/mi%20guia.md?ref={ref}": GUIDE,
    })
    assert sources.docs_from_repo(http, "https://codeberg.org/d/r", ["@scope/pkg@1.0"]).files == {"docs/mi guia.md": GUIDE}

    bb = "https://api.bitbucket.org/2.0/repositories/ws/r"
    http = FakeHttp({
        f"{bb}/src/{ref}/?max_depth=10&pagelen=100": {"values": [{"type": "commit_file", "path": "docs/mi guia.md"}]},
        f"{bb}/src/{ref}/docs/mi%20guia.md": GUIDE,
    })
    assert sources.docs_from_repo(http, "https://bitbucket.org/ws/r", ["@scope/pkg@1.0"]).files == {"docs/mi guia.md": GUIDE}


def test_later_tree_page_failure_is_not_a_partial_tree():
    # CB-09, escenario 13: una página posterior a la primera que falla hace no fiable el árbol.
    full_page = [{"type": "blob", "path": "docs/a.md"}] + [{"type": "blob", "path": f"src/f{i}.py"} for i in range(99)]
    readme = {"description": "# Tiny\n", "description_content_type": "text/markdown"}
    failures = (http_error(404), http_error(401), http_error(403), "<html>login</html>", b"\xff\xfe\x00\xc3(")

    def gitlab_responses(host, repo_url, failure, **extra):
        page2 = f"https://{host}/api/v4/projects/g%2Fr/repository/tree?ref=v1.0&recursive=true&per_page=100&page=2"
        return {**pypi_with_repo(repo_url, **extra), **gitlab_urls(host, "g/r", "v1.0", full_page, {"docs/a.md": "A"}), page2: failure}

    def gitea_responses(host, repo_url, failure, path="d/r", **extra):
        page2 = f"https://{host}/api/v1/repos/{path}/git/trees/v1.0?recursive=true&page=2"
        return {**pypi_with_repo(repo_url, **extra), **gitea_urls(host, path, "v1.0", [{"type": "blob", "path": "docs/a.md"}], {"docs/a.md": "A"}, truncated=True), page2: failure}

    # Gitea: un 400 en una página posterior se propaga como reason, igual que un 404 (el 400 solo vale en la primera).
    http = FakeHttp(gitea_responses("codeberg.org", "https://codeberg.org/d/r", http_error(400), **readme))
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert not doc.files and doc.reason.startswith("Error al descargar")
    assert not any("/git/trees/1.0" in u or "/git/trees/tiny-1.0" in u for u in http.requested_keys)

    for failure in failures:
        # Forge conocido: se propaga como reason, sin ficheros, sin README, sin otro ref ni otro adaptador.
        http = FakeHttp(gitlab_responses("gitlab.com", "https://gitlab.com/g/r", failure, **readme))
        doc = fetch_docs("tiny", "python", "1.0", http=http)
        assert not doc.files and doc.reason.startswith("Error al descargar"), failure
        assert not any("ref=1.0" in u or "ref=tiny-1.0" in u for u in http.requested_keys), failure
        assert not any("/raw" in u or "/api/v1/" in u for u in http.requested_keys), failure

        http = FakeHttp(gitea_responses("codeberg.org", "https://codeberg.org/d/r", failure, **readme))
        doc = fetch_docs("tiny", "python", "1.0", http=http)
        assert not doc.files and doc.reason.startswith("Error al descargar"), failure
        assert not any("/git/trees/1.0" in u or "/git/trees/tiny-1.0" in u for u in http.requested_keys), failure
        assert not any("/raw/" in u or "/api/v4/" in u for u in http.requested_keys), failure

        # Remoto desconocido: en GitLab «esa API no existe» y pasa a Gitea.
        http = FakeHttp({**gitlab_responses("git.empresa.com", "https://git.empresa.com/g/r.git", failure),
                         **gitea_urls("git.empresa.com", "g/r", "v1.0", GUIDE_BLOB, GUIDE_FILE)})
        doc = fetch_docs("tiny", "python", "1.0", http=http)
        assert doc.files == {"docs/guia.md": GUIDE} and not doc.reason, failure
        assert not any("/raw" in u and "/api/v4/" in u for u in http.requested_keys), failure

        # Remoto desconocido: ni GitLab ni Gitea (página 2 falla) dan árbol; sigue el README.
        repo_url = "https://git.empresa.com/g/r.git"
        responses = {**gitlab_responses("git.empresa.com", repo_url, failure, **readme),
                     **gitea_responses("git.empresa.com", repo_url, failure, path="g/r", **readme)}
        doc = fetch_docs("tiny", "python", "1.0", http=FakeHttp(responses))
        assert doc.files == {"README.md": "# Tiny\n"} and not doc.reason, failure

    # Una página 2 con forma inválida en un forge conocido lanza NoDocumentation: reason, sin ficheros.
    http = FakeHttp({**gitlab_responses("gitlab.com", "https://gitlab.com/g/r", {"no": "una lista"}, **readme)})
    doc = fetch_docs("tiny", "python", "1.0", http=http)
    assert not doc.files and "incompleto" in doc.reason

    # CB-01 sigue igual: un fallo en la primera página pasa al ref siguiente.
    v1 = "https://gitlab.com/api/v4/projects/g%2Fr/repository/tree?ref=v1.0&recursive=true&per_page=100&page=1"
    http = FakeHttp({**pypi_with_repo("https://gitlab.com/g/r"), v1: http_error(404), **gitlab_urls("gitlab.com", "g/r", "1.0", GUIDE_BLOB, GUIDE_FILE)})
    assert fetch_docs("tiny", "python", "1.0", http=http).files == {"docs/guia.md": GUIDE}
