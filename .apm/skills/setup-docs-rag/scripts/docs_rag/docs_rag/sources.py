"""Dónde está la documentación oficial de cada versión y cómo se descarga.

Orden por paquete: (1) generarla desde el paquete publicado (Go, Rust); (2) la documentación del
repositorio de la librería en esa versión; (3) el README de esa versión. Si no hay nada, el paquete
queda sin_doc con el motivo. Toda la red pasa por `http(url, cabeceras) -> bytes`, que se inyecta.
"""

from __future__ import annotations

import io
import json
import re
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from .cleanup import is_reference

USER_AGENT = "delivery-workflow-docs-rag"
MAX_FILES = 3000
MAX_BYTES = 60_000_000
_EXT_DOC = (".md", ".mdx", ".rst", ".markdown")


@dataclass
class Documentation:
    files: dict[str, str] = field(default_factory=dict)  # ruta → texto original (md, mdx, rst o html)
    hint: str | None = None  # tipo de documentación si la fuente lo sabe seguro
    origin: str = ""
    reason: str | None = None  # por qué no hay documentación (sin_doc)
    warnings: list[str] = field(default_factory=list)


class NoDocumentation(Exception):
    pass


def http_real(url: str, request_headers: dict | None = None, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(request_headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _json(http, url, request_headers=None):
    return json.loads(http(url, request_headers).decode("utf-8"))


def _text(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


# --- GitHub: árbol del repositorio y ficheros sueltos (sin bajar el repositorio entero) ---

_GITHUB = re.compile(r"github\.com(?::\d+(?=/))?[/:]([\w.-]+)/([\w.-]+?)(?:\.git)?(?:[/#?]|$)")


def github_repo(url: str | None) -> tuple[str, str] | None:
    m = _GITHUB.search(url or "")
    return (m.group(1), m.group(2)) if m else None


def _github_headers(token: str | None) -> dict:
    c = {"Accept": "application/vnd.github+json"}
    if token:
        c["Authorization"] = f"Bearer {token}"
    return c


def github_tree(http, owner: str, repo: str, refs: list[str], token: str | None) -> tuple[str, list[dict]] | None:
    """Primer ref que existe y su árbol completo. None si ninguno existe."""
    for ref in refs:
        if not ref:
            continue
        url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{urllib.parse.quote(ref, safe='')}?recursive=1"
        try:
            data = _json(http, url, _github_headers(token))
        except urllib.error.HTTPError as e:
            if e.code in (404, 422):
                continue
            raise
        return ref, data.get("tree", [])
    return None


def _download(fetch, file_paths: list[str]) -> dict[str, str]:
    """Baja los ficheros con `fetch(ruta) -> bytes` hasta MAX_FILES ficheros y MAX_BYTES bytes. Salta los que fallan."""
    output: dict[str, str] = {}
    total = 0
    for file_path in file_paths[:MAX_FILES]:
        try:
            data = fetch(file_path)
        except urllib.error.HTTPError:
            continue
        total += len(data)
        if total > MAX_BYTES:
            break
        output[file_path] = _text(data)
    return output


def _github_raw(http, owner, repo, ref, file_path: str, token=None) -> bytes:
    url = f"https://raw.githubusercontent.com/{owner}/{repo}/{urllib.parse.quote(ref, safe='')}/{urllib.parse.quote(file_path)}"
    return http(url, {"Authorization": f"Bearer {token}"} if token else None)


def github_files(http, owner, repo, ref, file_paths: list[str], token=None) -> dict[str, str]:
    return _download(lambda file_path: _github_raw(http, owner, repo, ref, file_path, token), file_paths)


# --- Remotos de repositorio: forge, host y ruta a partir de una URL ---

_KNOWN_FORGES = {"github.com": "github", "gitlab.com": "gitlab", "codeberg.org": "gitea", "bitbucket.org": "bitbucket"}
_TWO_SEGMENTS = ("github", "gitea", "bitbucket")
_PATH_CUT = re.compile(r"/(?:-|tree|blob|issues|merge_requests|wikis|releases)(?=/|$)")
_SCP_REMOTE = re.compile(r"^[\w.-]+@([\w.-]+):(?!//)(.+)$")
_GITLAB_SHORT = re.compile(r"^gitlab:(?!//)(.+)$")


@dataclass
class RepoRemote:
    kind: str  # github, gitlab, gitea, bitbucket o unknown (remoto git de otro host)
    host: str
    path: str  # segmentos separados por "/", sin .git


def parse_remote(url: str | None) -> RepoRemote | None:
    """Forge, host y ruta de la URL de un repositorio. None si no es un repositorio que se pueda consultar."""
    url = (url or "").strip()
    if not url:
        return None
    is_git = False
    short = _GITLAB_SHORT.match(url)
    scp = _SCP_REMOTE.match(url)
    if short:
        host, path, is_git = "gitlab.com", short.group(1), True
    elif scp:
        host, path, is_git = scp.group(1), scp.group(2), True
    else:
        parts = urllib.parse.urlsplit(url)
        scheme = parts.scheme.lower()
        if not parts.hostname or not (scheme in ("http", "https", "git", "ssh") or scheme.startswith("git+")):
            return None
        host = parts.hostname
        if parts.port and scheme in ("http", "https", "git+http", "git+https"):
            host = f"{host}:{parts.port}"
        path = parts.path
        is_git = scheme in ("git", "ssh") or scheme.startswith("git+")
    host = host.lower().removeprefix("www.")
    path = path.split("?", 1)[0].split("#", 1)[0]
    cut = _PATH_CUT.search("/" + path.lstrip("/"))
    if cut:
        path = ("/" + path.lstrip("/"))[: cut.start()]
    path = path.strip("/")
    if path.endswith(".git"):
        path = path[: -len(".git")]
        is_git = True
    segments = [s for s in path.split("/") if s]
    kind = _KNOWN_FORGES.get(host.split(":", 1)[0])
    if kind is None:
        if not is_git:
            return None
        kind = "unknown"
    if len(segments) < 2:
        return None
    if kind in _TWO_SEGMENTS:
        segments = segments[:2]
    return RepoRemote(kind=kind, host=host, path="/".join(segments))


def pick_repo_url(urls: list[str]) -> str | None:
    """La primera URL de un forge conocido; si no hay, la primera que sea un remoto git de otro host."""
    remotes = [(u, parse_remote(u)) for u in urls]
    for u, r in remotes:
        if r and r.kind != "unknown":
            return u
    for u, r in remotes:
        if r:
            return u
    return None


_DOC_DIRS = re.compile(r"(?i)(?:^|/)(?:docs?|documentation|content|guides?|reference|api|manual|website/docs|src/pages)(?:/|$)")


def doc_paths(tree: list[dict], base: str = "") -> list[str]:
    """Ficheros de documentación del árbol: carpetas de docs (o la base de un monorepo) y extensiones de texto."""
    file_paths = []
    for element in tree:
        if element.get("type") != "blob":
            continue
        file_path = element["path"]
        if base and not file_path.startswith(base.rstrip("/") + "/"):
            continue
        if not file_path.lower().endswith(_EXT_DOC):
            continue
        inside = file_path[len(base) + 1 :] if base else file_path
        if not _DOC_DIRS.search(inside):
            continue
        if not is_reference(inside):
            continue
        file_paths.append(file_path)
    return sorted(file_paths)


def _repo_hint(tree: list[dict], file_paths: list[str]) -> str | None:
    names = {n["path"] for n in tree if n.get("type") == "blob"}
    if any(p.endswith("mkdocs.yml") or p.endswith("mkdocs.yaml") for p in names):
        return "mkdocs"
    if any(p.endswith(("docs/conf.py", "doc/conf.py", "docs/source/conf.py")) for p in names) and any(r.endswith(".rst") for r in file_paths):
        return "sphinx"
    return None


# --- Forges: la misma forma (ref → árbol por páginas, fichero, origen) para cada API ---

MAX_TREE_PAGES = 100
_PAGE = 100
_API_MISSING = (401, 403, 404)


def _quote(text: str) -> str:
    return urllib.parse.quote(text, safe="")


class Forge:
    """Un forge. `tree_page` devuelve (entradas blob/tree, hay_más) o None si el ref o la API no existen."""

    missing_codes = _API_MISSING  # códigos HTTP que significan «ese ref o esa API no existen»
    speculative = False  # True en un remoto desconocido: cualquier fallo de red o de formato es «esa API no existe»

    def tree_page(self, http, ref: str, page: int) -> tuple[list[dict], bool] | None:
        raise NotImplementedError

    def fetch(self, http, ref: str, file_path: str) -> bytes:
        raise NotImplementedError

    def origin(self, ref: str) -> str:
        raise NotImplementedError

    def _get_json(self, http, url: str):
        """JSON de la URL, o None si esa API o ese ref no existen. Sin Authorization: solo GitHub lleva token."""
        try:
            return _json(http, url)
        except urllib.error.HTTPError as e:
            if self.speculative or e.code in self.missing_codes:
                return None
            raise
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None  # una página HTML de login, por ejemplo
        except (urllib.error.URLError, TimeoutError):
            if self.speculative:
                return None
            raise


class GitHubForge(Forge):
    def __init__(self, owner: str, repo: str, token: str | None = None):
        self.owner, self.repo, self.token = owner, repo, token

    def tree_page(self, http, ref, page):
        found = github_tree(http, self.owner, self.repo, [ref], self.token)
        return (found[1], False) if found else None

    def fetch(self, http, ref, file_path):
        return _github_raw(http, self.owner, self.repo, ref, file_path, self.token)

    def origin(self, ref):
        return f"https://github.com/{self.owner}/{self.repo}/tree/{ref}"


class GitLabForge(Forge):
    def __init__(self, host: str, path: str, speculative: bool = False):
        self.host, self.path, self.speculative = host, path, speculative
        self.project = f"https://{host}/api/v4/projects/{_quote(path)}"

    def tree_page(self, http, ref, page):
        url = f"{self.project}/repository/tree?ref={_quote(ref)}&recursive=true&per_page={_PAGE}&page={page}"
        data = self._get_json(http, url) if page == 1 else _json(http, url)  # un fallo en una página posterior se propaga
        if not isinstance(data, list):
            return None
        entries = [{"type": e.get("type"), "path": e["path"]} for e in data if isinstance(e, dict) and "path" in e]
        return entries, len(data) >= _PAGE

    def fetch(self, http, ref, file_path):
        return http(f"{self.project}/repository/files/{_quote(file_path)}/raw?ref={_quote(ref)}", None)

    def origin(self, ref):
        return f"https://{self.host}/{self.path}/-/tree/{ref}"


class GiteaForge(Forge):
    """Gitea y Forgejo. Un ref desconocido en el árbol devuelve 400 (`sha not found`), no 404."""

    missing_codes = (*_API_MISSING, 400)

    def __init__(self, host: str, path: str, speculative: bool = False):
        self.host, self.path, self.speculative = host, path, speculative
        self.api = f"https://{host}/api/v1/repos/{urllib.parse.quote(path)}"

    def tree_page(self, http, ref, page):
        url = f"{self.api}/git/trees/{_quote(ref)}?recursive=true&page={page}"
        data = self._get_json(http, url) if page == 1 else _json(http, url)  # un fallo en una página posterior se propaga
        if not isinstance(data, dict) or not isinstance(data.get("tree"), list):
            return None
        entries = [{"type": e.get("type"), "path": e["path"]} for e in data["tree"] if isinstance(e, dict) and "path" in e]
        return entries, bool(data.get("truncated"))

    def fetch(self, http, ref, file_path):
        return http(f"{self.api}/raw/{urllib.parse.quote(file_path)}?ref={_quote(ref)}", None)

    def origin(self, ref):
        kind = "commit" if re.fullmatch(r"[0-9a-f]{40}", ref) else "tag"
        return f"https://{self.host}/{self.path}/src/{kind}/{ref}"


class BitbucketForge(Forge):
    """Bitbucket Cloud. No cubre Bitbucket Server ni Data Center."""

    _TYPES = {"commit_file": "blob", "commit_directory": "tree"}
    _API_HOST = "api.bitbucket.org"

    def __init__(self, path: str):
        self.path = path
        self.api = f"https://{self._API_HOST}/2.0/repositories/{urllib.parse.quote(path)}"
        self._next: str | None = None

    def tree_page(self, http, ref, page):
        if page == 1:
            url = f"{self.api}/src/{_quote(ref)}/?max_depth=10&pagelen=100"
        elif self._next:
            url = self._next
        else:
            return None
        data = self._get_json(http, url) if page == 1 else _json(http, url)  # un fallo en una página posterior se propaga
        if not isinstance(data, dict) or not isinstance(data.get("values"), list):
            return None
        entries = [{"type": self._TYPES.get(e.get("type")), "path": e["path"]} for e in data["values"] if isinstance(e, dict) and "path" in e]
        nxt = data.get("next")
        self._next = nxt if isinstance(nxt, str) and urllib.parse.urlsplit(nxt).hostname == self._API_HOST else None
        return entries, self._next is not None

    def fetch(self, http, ref, file_path):
        return http(f"{self.api}/src/{_quote(ref)}/{urllib.parse.quote(file_path)}", None)

    def origin(self, ref):
        return f"https://bitbucket.org/{self.path}/src/{ref}"


def forge_chain(remote: RepoRemote, token: str | None = None) -> list[Forge]:
    """Los forges a probar para un remoto, en orden. El token solo llega a GitHub."""
    if remote.kind == "github":
        owner, repo = remote.path.split("/")[:2]
        return [GitHubForge(owner, repo, token)]
    if remote.kind == "gitlab":
        return [GitLabForge(remote.host, remote.path)]
    if remote.kind == "gitea":
        return [GiteaForge(remote.host, remote.path)]
    if remote.kind == "bitbucket":
        return [BitbucketForge(remote.path)]
    chain: list[Forge] = [GitLabForge(remote.host, remote.path, speculative=True)]
    if len(remote.path.split("/")) == 2:
        chain.append(GiteaForge(remote.host, remote.path, speculative=True))
    return chain


def _load_tree(forge: Forge, http, refs: list[str], base: str = "") -> tuple[str, list[dict]] | None:
    """Primer ref que existe y su árbol. Corta a MAX_TREE_PAGES páginas o al llegar a MAX_FILES ficheros de documentación."""
    for ref in refs:
        if not ref:
            continue
        tree: list[dict] = []
        page = 1
        while True:
            try:
                result = forge.tree_page(http, ref, page)
            except (urllib.error.URLError, TimeoutError, ValueError):
                if forge.speculative and page > 1:
                    return None  # esa API no existe (CB-09)
                raise
            if result is None:
                if page == 1:
                    break  # ese ref no existe: siguiente ref
                if forge.speculative:
                    return None
                raise NoDocumentation("El árbol del repositorio quedó incompleto: una página posterior no es válida.")
            entries, more = result
            tree += entries
            if not more or page >= MAX_TREE_PAGES or len(doc_paths(tree, base)) >= MAX_FILES:
                return ref, tree
            page += 1
    return None


def docs_from_repo(http, url_repo: str | None, refs: list[str], token=None, base: str = "") -> Documentation | None:
    gh = github_repo(url_repo)
    remote = RepoRemote("github", "github.com", f"{gh[0]}/{gh[1]}") if gh else parse_remote(url_repo)
    if not remote:
        return None
    prefix = base.rstrip("/") + "/" if base else ""
    for forge in forge_chain(remote, token):
        found = _load_tree(forge, http, refs, base)
        if not found:
            continue
        ref, tree = found  # el primer forge que devuelve un árbol decide
        file_paths = doc_paths(tree, base)
        if not file_paths:
            return None
        files = _download(lambda file_path: forge.fetch(http, ref, file_path), file_paths)
        if not files:
            return None
        return Documentation(
            files={r[len(prefix):] if prefix and r.startswith(prefix) else r: t for r, t in files.items()},
            hint=_repo_hint(tree, file_paths),
            origin=forge.origin(ref),
        )
    return None


# --- Python ---


def runtime_python(http, version: str) -> Documentation:
    mm = ".".join(version.split(".")[:2])
    url = f"https://docs.python.org/{mm}/archives/python-{mm}-docs-html.zip"
    try:
        data = http(url, None)
    except urllib.error.HTTPError as e:
        raise NoDocumentation(f"docs.python.org no tiene el zip de Python {mm} ({e.code}).") from e
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            rel = "/".join(name.split("/")[1:])
            if not rel.endswith(".html"):
                continue
            if not (rel.startswith(("library/", "reference/", "howto/", "tutorial/")) or rel == f"whatsnew/{mm}.html"):
                continue
            if not is_reference(rel):
                continue
            files[rel] = _text(z.read(name))
    return Documentation(files=files, hint="sphinx", origin=url)


def pypi_package(http, name: str, version: str, token=None) -> Documentation:
    try:
        info = _json(http, f"https://pypi.org/pypi/{urllib.parse.quote(name)}/{urllib.parse.quote(version)}/json")["info"]
    except urllib.error.HTTPError as e:
        raise NoDocumentation(f"PyPI no tiene {name} {version} ({e.code}).") from e
    urls = list((info.get("project_urls") or {}).values()) + [info.get("home_page") or ""]
    # Read the Docs, si publica el zip HTML de esa versión.
    for u in urls:
        m = re.search(r"https?://([\w-]+)\.readthedocs\.io", u or "")
        if not m:
            continue
        for v in (version, f"v{version}"):
            url = f"https://{m.group(1)}.readthedocs.io/_/downloads/en/{v}/htmlzip/"
            try:
                data = http(url, None)
            except urllib.error.HTTPError:
                continue
            files = {}
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for n in z.namelist():
                    rel = "/".join(n.split("/")[1:])
                    if rel.endswith(".html") and is_reference(rel):
                        files[rel] = _text(z.read(n))
            if files:
                html = next(iter(files.values()))
                hint = "mkdocs" if "mkdocs" in html.lower() else "sphinx"
                return Documentation(files=files, hint=hint, origin=url)
    repo = pick_repo_url(urls)
    refs = [f"v{version}", version, f"{name}-{version}", f"release-{version}", f"{name}@{version}"]
    doc = docs_from_repo(http, repo, refs, token)
    if doc:
        return doc
    readme = info.get("description") or ""
    if readme.strip():
        doc_type = (info.get("description_content_type") or "").lower()
        file_name = "README.rst" if "rst" in doc_type or (not doc_type and not readme.lstrip().startswith("#")) else "README.md"
        return Documentation(files={file_name: readme}, hint="markdown", origin=f"https://pypi.org/project/{name}/{version}/", warnings=[f"{name}: sin documentación en el repositorio para {version}; se usa el README de PyPI."])
    raise NoDocumentation(f"{name} {version}: ni Read the Docs, ni docs en el repositorio en esa versión, ni README en PyPI.")


# --- npm y Node ---


def npm_package(http, name: str, version: str, token=None) -> Documentation:
    try:
        meta = _json(http, f"https://registry.npmjs.org/{name.replace('/', '%2F')}/{urllib.parse.quote(version)}")
    except urllib.error.HTTPError as e:
        raise NoDocumentation(f"npm no tiene {name} {version} ({e.code}).") from e
    repo = meta.get("repository")
    url_repo = repo.get("url") if isinstance(repo, dict) else repo
    base = repo.get("directory", "") if isinstance(repo, dict) else ""
    refs = [meta.get("gitHead"), f"v{version}", version, f"{name}@{version}"]
    doc = docs_from_repo(http, url_repo, refs, token, base=base) or (docs_from_repo(http, url_repo, refs, token) if base else None)
    if doc:
        return doc
    url = f"https://cdn.jsdelivr.net/npm/{name}@{version}/README.md"
    try:
        readme = _text(http(url, None))
    except urllib.error.HTTPError:
        readme = ""
    if readme.strip():
        return Documentation(files={"README.md": readme}, hint="markdown", origin=url, warnings=[f"{name}: sin documentación en el repositorio para {version}; se usa el README del paquete."])
    raise NoDocumentation(f"{name} {version}: sin docs en el repositorio en esa versión ni README en el paquete.")


def resolve_node(http, version: str) -> str:
    versions = [v["version"] for v in _json(http, "https://nodejs.org/dist/index.json")]
    wanted = "v" + version.lstrip("v")
    exact_match = [v for v in versions if v == wanted]
    if exact_match:
        return exact_match[0]
    prefix = [v for v in versions if v.startswith(wanted + ".")]
    if not prefix:
        raise NoDocumentation(f"No existe Node {version} en nodejs.org.")
    return prefix[0]  # index.json va de la más nueva a la más antigua


def runtime_node(http, version: str, token=None) -> Documentation:
    tag = resolve_node(http, version)
    found = github_tree(http, "nodejs", "node", [tag], token)
    if not found:
        raise NoDocumentation(f"No se encuentra el tag {tag} de nodejs/node.")
    ref, tree = found
    file_paths = [n["path"] for n in tree if n.get("type") == "blob" and re.fullmatch(r"doc/api/[\w-]+\.md", n["path"]) and not n["path"].endswith(("/index.md", "/all.md", "/_toc.md", "/synopsis.md"))]
    files = github_files(http, "nodejs", "node", ref, file_paths, token)
    return Documentation(files={r.removeprefix("doc/api/"): t for r, t in files.items()}, hint="node", origin=f"https://github.com/nodejs/node/tree/{ref}/doc/api")


# --- Go: documentación generada desde el código del módulo publicado ---


def _escape_module(file_path: str) -> str:
    return re.sub(r"[A-Z]", lambda m: "!" + m.group(0).lower(), file_path)


_GO_PACKAGE = re.compile(r"^package\s+(\w+)", re.M)


def _preceding_comment(lines: list[str], i: int) -> str:
    doc = []
    j = i - 1
    while j >= 0 and lines[j].strip().startswith("//"):
        doc.insert(0, re.sub(r"^\s*//\s?", "", lines[j]))
        j -= 1
    return "\n".join(doc).strip()


def go_to_markdown(import_path: str, go_sources: dict[str, str]) -> str:
    """Markdown al estilo de `go doc -all` a partir de los .go de un paquete (sin necesitar Go instalado)."""
    name = "main"
    package_doc = ""
    funcs, kinds, methods, field_values, examples = [], [], {}, [], []
    for doc_file, code_text in sorted(go_sources.items()):
        lines = code_text.replace("\r\n", "\n").split("\n")
        for i, line in enumerate(lines):
            m = _GO_PACKAGE.match(line)
            if m and not doc_file.endswith("_test.go"):
                name = m.group(1)
                d = _preceding_comment(lines, i)
                if d and len(d) > len(package_doc):
                    package_doc = d
                continue
            if doc_file.endswith("_test.go"):
                e = re.match(r"^func (Example\w*)\(\)", line)
                if e:
                    page_body = []
                    for l in lines[i + 1 :]:
                        if l.startswith("}"):
                            break
                        page_body.append(l[1:] if l.startswith("\t") else l)
                    examples.append((e.group(1), _preceding_comment(lines, i), "\n".join(page_body)))
                continue
            f = re.match(r"^func\s+(\((\w+)\s+\*?(\w+)(?:\[[^\]]*\])?\)\s+)?([A-Z]\w*)(.*?)\s*\{?\s*$", line)
            if f:
                signature = line.rstrip(" {")
                doc = _preceding_comment(lines, i)
                if f.group(1):
                    methods.setdefault(f.group(3), []).append((signature, doc))
                else:
                    funcs.append((f.group(4), signature, doc))
                continue
            t = re.match(r"^type\s+([A-Z]\w*)\b(.*)$", line)
            if t:
                kinds.append((t.group(1), line.rstrip(" {"), _preceding_comment(lines, i)))
                continue
            v = re.match(r"^(const|var)\s+([A-Z]\w*)\b", line)
            if v:
                field_values.append((v.group(1), v.group(2), _preceding_comment(lines, i)))
    segments = [f"# package {name}", "", f'import "{import_path}"', ""]
    if package_doc:
        segments += [package_doc, ""]
    for class_name, n, doc in field_values:
        segments += [f"## {class_name} {n}", "", doc, ""] if doc else [f"## {class_name} {n}", ""]
    for n, signature, doc in sorted(funcs):
        segments += [f"## {signature}", "", "```go", signature, "```", ""] + ([doc, ""] if doc else [])
        segments += _examples_for(examples, f"Example{n}")
    for n, signature, doc in sorted(kinds):
        segments += [f"## {signature}", ""] + ([doc, ""] if doc else [])
        segments += _examples_for(examples, f"Example{n}")
        for msignature, mdoc in methods.get(n, []):
            segments += [f"### {msignature}", "", "```go", msignature, "```", ""] + ([mdoc, ""] if mdoc else [])
    if not funcs and not kinds:
        segments += _examples_for(examples, "Example")
    return "\n".join(segments).strip() + "\n"


def _examples_for(examples, prefix: str) -> list[str]:
    output = []
    for n, doc, page_body in examples:
        if n == prefix or n.startswith(prefix + "_"):
            output += [f"#### {n}", ""] + ([doc, ""] if doc else []) + ["```go", page_body.strip(), "```", ""]
    return output


_GO_SKIPPED = re.compile(r"(?:^|/)(?:internal|testdata|vendor|cmd)(?:/|$)")


def go_packages(module_root: str, files: dict[str, bytes], prefix: str = "") -> dict[str, str]:
    """Agrupa los .go por carpeta y genera un Markdown por paquete. Devuelve ruta.md → Markdown."""
    by_folder: dict[str, dict[str, str]] = {}
    for file_path, data in files.items():
        if not file_path.endswith(".go") or not file_path.startswith(prefix):
            continue
        rel = file_path[len(prefix) :]
        folder = str(PurePosixPath(rel).parent)
        folder = "" if folder == "." else folder
        if _GO_SKIPPED.search(folder):
            continue
        by_folder.setdefault(folder, {})[PurePosixPath(rel).name] = _text(data)
    output = {}
    for folder, go_sources in sorted(by_folder.items()):
        if not any(not f.endswith("_test.go") for f in go_sources):
            continue
        import_path = f"{module_root}/{folder}".rstrip("/") if module_root else folder
        output[f"{folder or 'root'}.md"] = go_to_markdown(import_path, go_sources)
    return output


def go_module(http, module: str, version: str) -> Documentation:
    v = version if version.startswith("v") else f"v{version}"
    url = f"https://proxy.golang.org/{_escape_module(module)}/@v/{v}.zip"
    try:
        data = http(url, None)
    except urllib.error.HTTPError as e:
        raise NoDocumentation(f"El proxy de Go no tiene {module} {v} ({e.code}).") from e
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        files = {n: z.read(n) for n in z.namelist() if n.endswith(".go")}
    prefix = f"{module}@{v}/"
    return Documentation(files=go_packages(module, files, prefix), hint="go", origin=url)


def resolve_go(http, version: str) -> str:
    if re.fullmatch(r"\d+\.\d+\.\d+", version):
        return version
    versions = [d["version"].removeprefix("go") for d in _json(http, "https://go.dev/dl/?mode=json&include=all") if d.get("stable")]
    candidate_paths = [v for v in versions if v == version or v.startswith(version + ".")]
    if not candidate_paths:
        raise NoDocumentation(f"No existe Go {version} en go.dev.")
    return candidate_paths[0]


def runtime_go(http, version: str) -> Documentation:
    exact_match = resolve_go(http, version)
    url = f"https://go.dev/dl/go{exact_match}.src.tar.gz"
    try:
        data = http(url, None)
    except urllib.error.HTTPError as e:
        raise NoDocumentation(f"go.dev no tiene las fuentes de Go {exact_match} ({e.code}).") from e
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar:
            if member.isfile() and member.name.startswith("go/src/") and member.name.endswith(".go"):
                f = tar.extractfile(member)
                if f:
                    files[member.name] = f.read()
    return Documentation(files=go_packages("", files, "go/src/"), hint="go", origin=url)


# --- Rust: JSON de rustdoc publicado en docs.rs ---


def _decompress_zstd(data: bytes) -> bytes:
    from compression import zstd

    return zstd.decompress(data)


_RUST_KIND = {"struct": "struct", "enum": "enum", "trait": "trait", "function": "fn", "macro": "macro", "proc_macro": "macro", "type_alias": "type",
              "typedef": "type", "constant": "const", "static": "static", "union": "union", "module": "mod", "trait_alias": "trait"}


def _feature_of(attrs) -> list[str]:
    return sorted(set(re.findall(r'feature\s*=\s*\\?"([\w-]+)', json.dumps(attrs))))


def rustdoc_to_markdown(data: dict, crate: str) -> dict[str, str]:
    """Un Markdown por módulo del crate a partir del JSON de rustdoc."""
    index = data.get("index", {})
    paths = data.get("paths", {})
    by_module: dict[str, list[str]] = {}

    def path_of(item_id) -> str | None:
        p = paths.get(str(item_id))
        return "::".join(p["path"]) if p else None

    def block(level: str, doc_type: str, file_path: str, item: dict) -> list[str]:
        lines = [f"{level} {doc_type} `{file_path}`", ""]
        dep = item.get("deprecation")
        if dep:
            lines += [f"Deprecated since {dep.get('since') or '?'}: {dep.get('note') or ''}".rstrip(": "), ""]
        feats = _feature_of(item.get("attrs", []))
        if feats:
            lines += [f"Available on crate feature {' and '.join(feats)} only.", ""]
        if item.get("docs"):
            lines += [item["docs"].strip(), ""]
        return lines

    for item_id, item in index.items():
        if item.get("crate_id") != 0 or not item.get("name"):
            continue
        inner = item.get("inner") or {}
        package_key = next(iter(inner), None) if isinstance(inner, dict) else None
        doc_type = _RUST_KIND.get(package_key or "")
        if not doc_type or doc_type == "mod":
            continue
        file_path = path_of(item_id)
        if not file_path:
            continue
        module = file_path.rsplit("::", 1)[0] if "::" in file_path else crate
        lines = block("##", doc_type, file_path, item)
        # Métodos de los impl propios del tipo.
        for impl_id in (inner.get(package_key) or {}).get("impls", []) if isinstance(inner.get(package_key), dict) else []:
            impl = index.get(str(impl_id), {}).get("inner", {}).get("impl", {})
            if impl.get("trait") is not None:
                continue
            for mid in impl.get("items", []):
                method = index.get(str(mid))
                if method and method.get("name") and "function" in (method.get("inner") or {}):
                    lines += block("###", "method", f"{file_path.rsplit('::', 1)[-1]}::{method['name']}", method)
        by_module.setdefault(module, []).extend(lines)
    return {f"{m.replace('::', '/')}.md": f"# mod `{m}`\n\n" + "\n".join(l) for m, l in sorted(by_module.items())}


def crate_rust(http, name: str, version: str) -> Documentation:
    url = f"https://docs.rs/crate/{name}/{version}/json"
    try:
        data = json.loads(_decompress_zstd(http(url, None)))
        files = rustdoc_to_markdown(data, name.replace("-", "_"))
        if files:
            return Documentation(files=files, hint="rust", origin=url)
    except (urllib.error.HTTPError, ValueError, KeyError):
        pass
    url_readme = f"https://crates.io/api/v1/crates/{name}/{version}/readme"
    try:
        html = _text(http(url_readme, None))
    except urllib.error.HTTPError as e:
        raise NoDocumentation(f"{name} {version}: docs.rs no publica su JSON y crates.io no tiene README ({e.code}).") from e
    return Documentation(files={"README.html": html}, hint="markdown", origin=url_readme, warnings=[f"{name}: docs.rs no publica el JSON de {version}; se usa el README de crates.io."])


# --- Entrada única ---


def fetch_docs(package: str, ecosystem: str, version: str, *, http=http_real, token: str | None = None) -> Documentation:
    """Documentación de un paquete en una versión. Nunca lanza: si falla, devuelve motivo (sin_doc)."""
    try:
        if ecosystem == "runtime":
            if package == "python":
                return runtime_python(http, version)
            if package == "node":
                return runtime_node(http, version, token)
            if package == "go":
                return runtime_go(http, version)
            if package == "rust":
                raise NoDocumentation("La documentación de la biblioteca estándar de Rust no se publica en un formato descargable por versión.")
            raise NoDocumentation(f"Runtime desconocido: {package}.")
        if ecosystem == "python":
            return pypi_package(http, package, version, token)
        if ecosystem == "npm":
            return npm_package(http, package, version, token)
        if ecosystem == "go":
            return go_module(http, package, version)
        if ecosystem == "rust":
            return crate_rust(http, package, version)
        raise NoDocumentation(f"Ecosistema desconocido: {ecosystem}.")
    except NoDocumentation as e:
        return Documentation(reason=str(e))
    except (urllib.error.URLError, TimeoutError, OSError, zipfile.BadZipFile, tarfile.TarError, json.JSONDecodeError, UnicodeDecodeError) as e:
        return Documentation(reason=f"Error al descargar la documentación: {e}")
