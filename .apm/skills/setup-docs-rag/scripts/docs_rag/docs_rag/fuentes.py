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

from .limpieza import es_referencia

AGENTE = "delivery-workflow-docs-rag"
MAX_FICHEROS = 3000
MAX_BYTES = 60_000_000
_EXT_DOC = (".md", ".mdx", ".rst", ".markdown")


@dataclass
class Documentacion:
    ficheros: dict[str, str] = field(default_factory=dict)  # ruta → texto original (md, mdx, rst o html)
    pista: str | None = None  # tipo de documentación si la fuente lo sabe seguro
    origen: str = ""
    motivo: str | None = None  # por qué no hay documentación (sin_doc)
    avisos: list[str] = field(default_factory=list)


class SinDocumentacion(Exception):
    pass


def http_real(url: str, cabeceras: dict | None = None, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": AGENTE, **(cabeceras or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _json(http, url, cabeceras=None):
    return json.loads(http(url, cabeceras).decode("utf-8"))


def _texto(datos: bytes) -> str:
    return datos.decode("utf-8", errors="replace")


# --- GitHub: árbol del repositorio y ficheros sueltos (sin bajar el repositorio entero) ---

_GITHUB = re.compile(r"github\.com[/:]([\w.-]+)/([\w.-]+?)(?:\.git)?(?:[/#?]|$)")


def repo_github(url: str | None) -> tuple[str, str] | None:
    m = _GITHUB.search(url or "")
    return (m.group(1), m.group(2)) if m else None


def _cabeceras_github(token: str | None) -> dict:
    c = {"Accept": "application/vnd.github+json"}
    if token:
        c["Authorization"] = f"Bearer {token}"
    return c


def arbol_github(http, owner: str, repo: str, refs: list[str], token: str | None) -> tuple[str, list[dict]] | None:
    """Primer ref que existe y su árbol completo. None si ninguno existe."""
    for ref in refs:
        if not ref:
            continue
        url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{urllib.parse.quote(ref, safe='')}?recursive=1"
        try:
            datos = _json(http, url, _cabeceras_github(token))
        except urllib.error.HTTPError as e:
            if e.code in (404, 422):
                continue
            raise
        return ref, datos.get("tree", [])
    return None


def ficheros_github(http, owner, repo, ref, rutas: list[str], token=None) -> dict[str, str]:
    salida: dict[str, str] = {}
    total = 0
    for ruta in rutas[:MAX_FICHEROS]:
        url = f"https://raw.githubusercontent.com/{owner}/{repo}/{urllib.parse.quote(ref, safe='')}/{urllib.parse.quote(ruta)}"
        try:
            datos = http(url, {"Authorization": f"Bearer {token}"} if token else None)
        except urllib.error.HTTPError:
            continue
        total += len(datos)
        if total > MAX_BYTES:
            break
        salida[ruta] = _texto(datos)
    return salida


_CARPETAS_DOC = re.compile(r"(?i)(?:^|/)(?:docs?|documentation|content|guides?|reference|api|manual|website/docs|src/pages)(?:/|$)")


def rutas_documentacion(arbol: list[dict], base: str = "") -> list[str]:
    """Ficheros de documentación del árbol: carpetas de docs (o la base de un monorepo) y extensiones de texto."""
    rutas = []
    for nodo in arbol:
        if nodo.get("type") != "blob":
            continue
        ruta = nodo["path"]
        if base and not ruta.startswith(base.rstrip("/") + "/"):
            continue
        if not ruta.lower().endswith(_EXT_DOC):
            continue
        dentro = ruta[len(base) + 1 :] if base else ruta
        if not _CARPETAS_DOC.search(dentro):
            continue
        if not es_referencia(dentro):
            continue
        rutas.append(ruta)
    return sorted(rutas)


def _pista_repo(arbol: list[dict], rutas: list[str]) -> str | None:
    nombres = {n["path"] for n in arbol if n.get("type") == "blob"}
    if any(p.endswith("mkdocs.yml") or p.endswith("mkdocs.yaml") for p in nombres):
        return "mkdocs"
    if any(p.endswith(("docs/conf.py", "doc/conf.py", "docs/source/conf.py")) for p in nombres) and any(r.endswith(".rst") for r in rutas):
        return "sphinx"
    return None


def docs_de_repo(http, url_repo: str | None, refs: list[str], token=None, base: str = "") -> Documentacion | None:
    gh = repo_github(url_repo)
    if not gh:
        return None
    hallado = arbol_github(http, *gh, refs, token)
    if not hallado:
        return None
    ref, arbol = hallado
    rutas = rutas_documentacion(arbol, base)
    if not rutas:
        return None
    ficheros = ficheros_github(http, *gh, ref, rutas, token)
    if not ficheros:
        return None
    prefijo = base.rstrip("/") + "/" if base else ""
    return Documentacion(
        ficheros={r[len(prefijo):] if prefijo and r.startswith(prefijo) else r: t for r, t in ficheros.items()},
        pista=_pista_repo(arbol, rutas),
        origen=f"https://github.com/{gh[0]}/{gh[1]}/tree/{ref}",
    )


# --- Python ---


def runtime_python(http, version: str) -> Documentacion:
    mm = ".".join(version.split(".")[:2])
    url = f"https://docs.python.org/{mm}/archives/python-{mm}-docs-html.zip"
    try:
        datos = http(url, None)
    except urllib.error.HTTPError as e:
        raise SinDocumentacion(f"docs.python.org no tiene el zip de Python {mm} ({e.code}).") from e
    ficheros = {}
    with zipfile.ZipFile(io.BytesIO(datos)) as z:
        for nombre in z.namelist():
            rel = "/".join(nombre.split("/")[1:])
            if not rel.endswith(".html"):
                continue
            if not (rel.startswith(("library/", "reference/", "howto/", "tutorial/")) or rel == f"whatsnew/{mm}.html"):
                continue
            if not es_referencia(rel):
                continue
            ficheros[rel] = _texto(z.read(nombre))
    return Documentacion(ficheros=ficheros, pista="sphinx", origen=url)


def paquete_pypi(http, nombre: str, version: str, token=None) -> Documentacion:
    try:
        info = _json(http, f"https://pypi.org/pypi/{urllib.parse.quote(nombre)}/{urllib.parse.quote(version)}/json")["info"]
    except urllib.error.HTTPError as e:
        raise SinDocumentacion(f"PyPI no tiene {nombre} {version} ({e.code}).") from e
    urls = list((info.get("project_urls") or {}).values()) + [info.get("home_page") or ""]
    # Read the Docs, si publica el zip HTML de esa versión.
    for u in urls:
        m = re.search(r"https?://([\w-]+)\.readthedocs\.io", u or "")
        if not m:
            continue
        for v in (version, f"v{version}"):
            url = f"https://{m.group(1)}.readthedocs.io/_/downloads/en/{v}/htmlzip/"
            try:
                datos = http(url, None)
            except urllib.error.HTTPError:
                continue
            ficheros = {}
            with zipfile.ZipFile(io.BytesIO(datos)) as z:
                for n in z.namelist():
                    rel = "/".join(n.split("/")[1:])
                    if rel.endswith(".html") and es_referencia(rel):
                        ficheros[rel] = _texto(z.read(n))
            if ficheros:
                html = next(iter(ficheros.values()))
                pista = "mkdocs" if "mkdocs" in html.lower() else "sphinx"
                return Documentacion(ficheros=ficheros, pista=pista, origen=url)
    repo = next((u for u in urls if repo_github(u)), None)
    refs = [f"v{version}", version, f"{nombre}-{version}", f"release-{version}", f"{nombre}@{version}"]
    doc = docs_de_repo(http, repo, refs, token)
    if doc:
        return doc
    readme = info.get("description") or ""
    if readme.strip():
        tipo = (info.get("description_content_type") or "").lower()
        nombre_fichero = "README.rst" if "rst" in tipo or (not tipo and not readme.lstrip().startswith("#")) else "README.md"
        return Documentacion(ficheros={nombre_fichero: readme}, pista="markdown", origen=f"https://pypi.org/project/{nombre}/{version}/", avisos=[f"{nombre}: sin documentación en el repositorio para {version}; se usa el README de PyPI."])
    raise SinDocumentacion(f"{nombre} {version}: ni Read the Docs, ni docs en el repositorio en esa versión, ni README en PyPI.")


# --- npm y Node ---


def paquete_npm(http, nombre: str, version: str, token=None) -> Documentacion:
    try:
        meta = _json(http, f"https://registry.npmjs.org/{nombre.replace('/', '%2F')}/{urllib.parse.quote(version)}")
    except urllib.error.HTTPError as e:
        raise SinDocumentacion(f"npm no tiene {nombre} {version} ({e.code}).") from e
    repo = meta.get("repository")
    url_repo = repo.get("url") if isinstance(repo, dict) else repo
    base = repo.get("directory", "") if isinstance(repo, dict) else ""
    refs = [meta.get("gitHead"), f"v{version}", version, f"{nombre}@{version}"]
    doc = docs_de_repo(http, url_repo, refs, token, base=base) or (docs_de_repo(http, url_repo, refs, token) if base else None)
    if doc:
        return doc
    url = f"https://cdn.jsdelivr.net/npm/{nombre}@{version}/README.md"
    try:
        readme = _texto(http(url, None))
    except urllib.error.HTTPError:
        readme = ""
    if readme.strip():
        return Documentacion(ficheros={"README.md": readme}, pista="markdown", origen=url, avisos=[f"{nombre}: sin documentación en el repositorio para {version}; se usa el README del paquete."])
    raise SinDocumentacion(f"{nombre} {version}: sin docs en el repositorio en esa versión ni README en el paquete.")


def resolver_node(http, version: str) -> str:
    versiones = [v["version"] for v in _json(http, "https://nodejs.org/dist/index.json")]
    buscada = "v" + version.lstrip("v")
    exacta = [v for v in versiones if v == buscada]
    if exacta:
        return exacta[0]
    prefijo = [v for v in versiones if v.startswith(buscada + ".")]
    if not prefijo:
        raise SinDocumentacion(f"No existe Node {version} en nodejs.org.")
    return prefijo[0]  # index.json va de la más nueva a la más antigua


def runtime_node(http, version: str, token=None) -> Documentacion:
    tag = resolver_node(http, version)
    hallado = arbol_github(http, "nodejs", "node", [tag], token)
    if not hallado:
        raise SinDocumentacion(f"No se encuentra el tag {tag} de nodejs/node.")
    ref, arbol = hallado
    rutas = [n["path"] for n in arbol if n.get("type") == "blob" and re.fullmatch(r"doc/api/[\w-]+\.md", n["path"]) and not n["path"].endswith(("/index.md", "/all.md", "/_toc.md", "/synopsis.md"))]
    ficheros = ficheros_github(http, "nodejs", "node", ref, rutas, token)
    return Documentacion(ficheros={r.removeprefix("doc/api/"): t for r, t in ficheros.items()}, pista="node", origen=f"https://github.com/nodejs/node/tree/{ref}/doc/api")


# --- Go: documentación generada desde el código del módulo publicado ---


def _escapar_modulo(ruta: str) -> str:
    return re.sub(r"[A-Z]", lambda m: "!" + m.group(0).lower(), ruta)


_GO_PACKAGE = re.compile(r"^package\s+(\w+)", re.M)


def _comentario_previo(lineas: list[str], i: int) -> str:
    doc = []
    j = i - 1
    while j >= 0 and lineas[j].strip().startswith("//"):
        doc.insert(0, re.sub(r"^\s*//\s?", "", lineas[j]))
        j -= 1
    return "\n".join(doc).strip()


def go_a_markdown(import_path: str, fuentes_go: dict[str, str]) -> str:
    """Markdown al estilo de `go doc -all` a partir de los .go de un paquete (sin necesitar Go instalado)."""
    nombre = "main"
    doc_paquete = ""
    funcs, tipos, metodos, valores, ejemplos = [], [], {}, [], []
    for fichero, codigo in sorted(fuentes_go.items()):
        lineas = codigo.replace("\r\n", "\n").split("\n")
        for i, linea in enumerate(lineas):
            m = _GO_PACKAGE.match(linea)
            if m and not fichero.endswith("_test.go"):
                nombre = m.group(1)
                d = _comentario_previo(lineas, i)
                if d and len(d) > len(doc_paquete):
                    doc_paquete = d
                continue
            if fichero.endswith("_test.go"):
                e = re.match(r"^func (Example\w*)\(\)", linea)
                if e:
                    cuerpo = []
                    for l in lineas[i + 1 :]:
                        if l.startswith("}"):
                            break
                        cuerpo.append(l[1:] if l.startswith("\t") else l)
                    ejemplos.append((e.group(1), _comentario_previo(lineas, i), "\n".join(cuerpo)))
                continue
            f = re.match(r"^func\s+(\((\w+)\s+\*?(\w+)(?:\[[^\]]*\])?\)\s+)?([A-Z]\w*)(.*?)\s*\{?\s*$", linea)
            if f:
                firma = linea.rstrip(" {")
                doc = _comentario_previo(lineas, i)
                if f.group(1):
                    metodos.setdefault(f.group(3), []).append((firma, doc))
                else:
                    funcs.append((f.group(4), firma, doc))
                continue
            t = re.match(r"^type\s+([A-Z]\w*)\b(.*)$", linea)
            if t:
                tipos.append((t.group(1), linea.rstrip(" {"), _comentario_previo(lineas, i)))
                continue
            v = re.match(r"^(const|var)\s+([A-Z]\w*)\b", linea)
            if v:
                valores.append((v.group(1), v.group(2), _comentario_previo(lineas, i)))
    partes = [f"# package {nombre}", "", f'import "{import_path}"', ""]
    if doc_paquete:
        partes += [doc_paquete, ""]
    for clase, n, doc in valores:
        partes += [f"## {clase} {n}", "", doc, ""] if doc else [f"## {clase} {n}", ""]
    for n, firma, doc in sorted(funcs):
        partes += [f"## {firma}", "", "```go", firma, "```", ""] + ([doc, ""] if doc else [])
        partes += _ejemplos_de(ejemplos, f"Example{n}")
    for n, firma, doc in sorted(tipos):
        partes += [f"## {firma}", ""] + ([doc, ""] if doc else [])
        partes += _ejemplos_de(ejemplos, f"Example{n}")
        for mfirma, mdoc in metodos.get(n, []):
            partes += [f"### {mfirma}", "", "```go", mfirma, "```", ""] + ([mdoc, ""] if mdoc else [])
    if not funcs and not tipos:
        partes += _ejemplos_de(ejemplos, "Example")
    return "\n".join(partes).strip() + "\n"


def _ejemplos_de(ejemplos, prefijo: str) -> list[str]:
    salida = []
    for n, doc, cuerpo in ejemplos:
        if n == prefijo or n.startswith(prefijo + "_"):
            salida += [f"#### {n}", ""] + ([doc, ""] if doc else []) + ["```go", cuerpo.strip(), "```", ""]
    return salida


_GO_FUERA = re.compile(r"(?:^|/)(?:internal|testdata|vendor|cmd)(?:/|$)")


def paquetes_go(raiz_modulo: str, ficheros: dict[str, bytes], prefijo: str = "") -> dict[str, str]:
    """Agrupa los .go por carpeta y genera un Markdown por paquete. Devuelve ruta.md → Markdown."""
    por_carpeta: dict[str, dict[str, str]] = {}
    for ruta, datos in ficheros.items():
        if not ruta.endswith(".go") or not ruta.startswith(prefijo):
            continue
        rel = ruta[len(prefijo) :]
        carpeta = str(PurePosixPath(rel).parent)
        carpeta = "" if carpeta == "." else carpeta
        if _GO_FUERA.search(carpeta):
            continue
        por_carpeta.setdefault(carpeta, {})[PurePosixPath(rel).name] = _texto(datos)
    salida = {}
    for carpeta, fuentes_go in sorted(por_carpeta.items()):
        if not any(not f.endswith("_test.go") for f in fuentes_go):
            continue
        import_path = f"{raiz_modulo}/{carpeta}".rstrip("/") if raiz_modulo else carpeta
        salida[f"{carpeta or 'root'}.md"] = go_a_markdown(import_path, fuentes_go)
    return salida


def modulo_go(http, modulo: str, version: str) -> Documentacion:
    v = version if version.startswith("v") else f"v{version}"
    url = f"https://proxy.golang.org/{_escapar_modulo(modulo)}/@v/{v}.zip"
    try:
        datos = http(url, None)
    except urllib.error.HTTPError as e:
        raise SinDocumentacion(f"El proxy de Go no tiene {modulo} {v} ({e.code}).") from e
    with zipfile.ZipFile(io.BytesIO(datos)) as z:
        ficheros = {n: z.read(n) for n in z.namelist() if n.endswith(".go")}
    prefijo = f"{modulo}@{v}/"
    return Documentacion(ficheros=paquetes_go(modulo, ficheros, prefijo), pista="go", origen=url)


def resolver_go(http, version: str) -> str:
    if re.fullmatch(r"\d+\.\d+\.\d+", version):
        return version
    versiones = [d["version"].removeprefix("go") for d in _json(http, "https://go.dev/dl/?mode=json&include=all") if d.get("stable")]
    candidatas = [v for v in versiones if v == version or v.startswith(version + ".")]
    if not candidatas:
        raise SinDocumentacion(f"No existe Go {version} en go.dev.")
    return candidatas[0]


def runtime_go(http, version: str) -> Documentacion:
    exacta = resolver_go(http, version)
    url = f"https://go.dev/dl/go{exacta}.src.tar.gz"
    try:
        datos = http(url, None)
    except urllib.error.HTTPError as e:
        raise SinDocumentacion(f"go.dev no tiene las fuentes de Go {exacta} ({e.code}).") from e
    ficheros = {}
    with tarfile.open(fileobj=io.BytesIO(datos), mode="r:gz") as tar:
        for miembro in tar:
            if miembro.isfile() and miembro.name.startswith("go/src/") and miembro.name.endswith(".go"):
                f = tar.extractfile(miembro)
                if f:
                    ficheros[miembro.name] = f.read()
    return Documentacion(ficheros=paquetes_go("", ficheros, "go/src/"), pista="go", origen=url)


# --- Rust: JSON de rustdoc publicado en docs.rs ---


def _descomprimir_zstd(datos: bytes) -> bytes:
    try:
        from compression import zstd  # Python 3.14+

        return zstd.decompress(datos)
    except ImportError:
        import zstandard

        return zstandard.ZstdDecompressor().decompressobj().decompress(datos)


_RUST_TIPO = {"struct": "struct", "enum": "enum", "trait": "trait", "function": "fn", "macro": "macro", "proc_macro": "macro", "type_alias": "type",
              "typedef": "type", "constant": "const", "static": "static", "union": "union", "module": "mod", "trait_alias": "trait"}


def _feature_de(attrs) -> list[str]:
    return sorted(set(re.findall(r'feature\s*=\s*\\?"([\w-]+)', json.dumps(attrs))))


def rustdoc_a_markdown(datos: dict, crate: str) -> dict[str, str]:
    """Un Markdown por módulo del crate a partir del JSON de rustdoc."""
    index = datos.get("index", {})
    paths = datos.get("paths", {})
    por_modulo: dict[str, list[str]] = {}

    def ruta_de(item_id) -> str | None:
        p = paths.get(str(item_id))
        return "::".join(p["path"]) if p else None

    def bloque(nivel: str, tipo: str, ruta: str, item: dict) -> list[str]:
        lineas = [f"{nivel} {tipo} `{ruta}`", ""]
        dep = item.get("deprecation")
        if dep:
            lineas += [f"Deprecated since {dep.get('since') or '?'}: {dep.get('note') or ''}".rstrip(": "), ""]
        feats = _feature_de(item.get("attrs", []))
        if feats:
            lineas += [f"Available on crate feature {' and '.join(feats)} only.", ""]
        if item.get("docs"):
            lineas += [item["docs"].strip(), ""]
        return lineas

    for item_id, item in index.items():
        if item.get("crate_id") != 0 or not item.get("name"):
            continue
        inner = item.get("inner") or {}
        clave = next(iter(inner), None) if isinstance(inner, dict) else None
        tipo = _RUST_TIPO.get(clave or "")
        if not tipo or tipo == "mod":
            continue
        ruta = ruta_de(item_id)
        if not ruta:
            continue
        modulo = ruta.rsplit("::", 1)[0] if "::" in ruta else crate
        lineas = bloque("##", tipo, ruta, item)
        # Métodos de los impl propios del tipo.
        for impl_id in (inner.get(clave) or {}).get("impls", []) if isinstance(inner.get(clave), dict) else []:
            impl = index.get(str(impl_id), {}).get("inner", {}).get("impl", {})
            if impl.get("trait") is not None:
                continue
            for mid in impl.get("items", []):
                metodo = index.get(str(mid))
                if metodo and metodo.get("name") and "function" in (metodo.get("inner") or {}):
                    lineas += bloque("###", "method", f"{ruta.rsplit('::', 1)[-1]}::{metodo['name']}", metodo)
        por_modulo.setdefault(modulo, []).extend(lineas)
    return {f"{m.replace('::', '/')}.md": f"# mod `{m}`\n\n" + "\n".join(l) for m, l in sorted(por_modulo.items())}


def crate_rust(http, nombre: str, version: str) -> Documentacion:
    url = f"https://docs.rs/crate/{nombre}/{version}/json"
    try:
        datos = json.loads(_descomprimir_zstd(http(url, None)))
        ficheros = rustdoc_a_markdown(datos, nombre.replace("-", "_"))
        if ficheros:
            return Documentacion(ficheros=ficheros, pista="rust", origen=url)
    except (urllib.error.HTTPError, ValueError, KeyError):
        pass
    url_readme = f"https://crates.io/api/v1/crates/{nombre}/{version}/readme"
    try:
        html = _texto(http(url_readme, None))
    except urllib.error.HTTPError as e:
        raise SinDocumentacion(f"{nombre} {version}: docs.rs no publica su JSON y crates.io no tiene README ({e.code}).") from e
    return Documentacion(ficheros={"README.html": html}, pista="markdown", origen=url_readme, avisos=[f"{nombre}: docs.rs no publica el JSON de {version}; se usa el README de crates.io."])


# --- Entrada única ---


def documentar(paquete: str, ecosistema: str, version: str, *, http=http_real, token: str | None = None) -> Documentacion:
    """Documentación de un paquete en una versión. Nunca lanza: si falla, devuelve motivo (sin_doc)."""
    try:
        if ecosistema == "runtime":
            if paquete == "python":
                return runtime_python(http, version)
            if paquete == "node":
                return runtime_node(http, version, token)
            if paquete == "go":
                return runtime_go(http, version)
            if paquete == "rust":
                raise SinDocumentacion("La documentación de la biblioteca estándar de Rust no se publica en un formato descargable por versión.")
            raise SinDocumentacion(f"Runtime desconocido: {paquete}.")
        if ecosistema == "python":
            return paquete_pypi(http, paquete, version, token)
        if ecosistema == "npm":
            return paquete_npm(http, paquete, version, token)
        if ecosistema == "go":
            return modulo_go(http, paquete, version)
        if ecosistema == "rust":
            return crate_rust(http, paquete, version)
        raise SinDocumentacion(f"Ecosistema desconocido: {ecosistema}.")
    except SinDocumentacion as e:
        return Documentacion(motivo=str(e))
    except (urllib.error.URLError, TimeoutError, OSError, zipfile.BadZipFile, tarfile.TarError, json.JSONDecodeError) as e:
        return Documentacion(motivo=f"Error al descargar la documentación: {e}")
