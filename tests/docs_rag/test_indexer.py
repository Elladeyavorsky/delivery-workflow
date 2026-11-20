import json

from fakes import FakeEmbedder, FakeHttp, FakeStore

from docs_rag.indexer import drop, index_project, read_token

NPM = {
    "https://registry.npmjs.org/zustand/5.0.2": {"repository": {"url": "git+https://github.com/pmndrs/zustand.git"}, "gitHead": "abc"},
    "https://api.github.com/repos/pmndrs/zustand/git/trees/abc?recursive=1": {"tree": [
        {"type": "blob", "path": "docs/guides/slices.md"},
        {"type": "blob", "path": "docs/apis/create.md"},
    ]},
    "https://raw.githubusercontent.com/pmndrs/zustand/abc/docs/guides/slices.md": "# Slices\n\nSplit the store.\n\n```ts\nconst a = 1\n```\n",
    "https://raw.githubusercontent.com/pmndrs/zustand/abc/docs/apis/create.md": "# `create`\n\nCreates a store. **Deprecated** option `equalityFn`.\n",
    "https://registry.npmjs.org/zustand/5.0.3": {"repository": {"url": "git+https://github.com/pmndrs/zustand.git"}, "gitHead": "def"},
    "https://api.github.com/repos/pmndrs/zustand/git/trees/def?recursive=1": {"tree": [{"type": "blob", "path": "docs/apis/create.md"}]},
    "https://raw.githubusercontent.com/pmndrs/zustand/def/docs/apis/create.md": "# `create`\n\nCreates a store.\n",
}


def request_data(root, packages):
    folder = root / ".docs-rag"
    folder.mkdir(exist_ok=True)
    (folder / "request.json").write_text(json.dumps({"packages": packages}), encoding="utf-8")


def inventory(root):
    return json.loads((root / ".docs-rag" / "inventory.json").read_text(encoding="utf-8"))


def test_indexes_reindexes_and_deletes_only_what_changed(tmp_path):
    store, emb = FakeStore(), FakeEmbedder()
    http = FakeHttp(NPM)
    request_data(tmp_path, [{"package": "zustand", "ecosystem": "npm", "version": "5.0.2"}, {"package": "left-pad", "ecosystem": "npm", "version": "1.3.0"}])
    r = index_project(tmp_path, http=http, store=store, embedder=emb)
    assert r["indexed"] == ["npm:zustand"] and r["no_docs"][0]["package"] == "npm:left-pad"
    inv = inventory(tmp_path)
    z = inv["packages"]["npm:zustand"]
    assert z["status"] == "indexed" and z["doc_type"] == "markdown" and z["chunks"] == store.count_chunks("npm", "zustand") == 2
    assert "symbols" in z["filters"] and z["origin"].endswith("/tree/abc")
    assert inv["packages"]["npm:left-pad"]["status"] == "no_docs"
    assert (tmp_path / ".docs-rag" / "docs" / "npm_zustand" / "docs" / "apis" / "create.md").is_file()
    payload = next(p["payload"] for p in store.points.values() if p["payload"]["source"] == "docs/guides/slices.md")
    assert payload["has_code"] is True and payload["version"] == "5.0.2" and payload["heading_path"] == "Slices"

    # Sin cambios: no se descarga ni se embebe nada.
    requested_keys, calls = len(http.requested_keys), emb.calls
    r = index_project(tmp_path, http=http, store=store, embedder=emb)
    assert r["unchanged"] == ["npm:zustand", "npm:left-pad"] and r["indexed"] == r["reindexed"] == []
    assert len(http.requested_keys) == requested_keys and emb.calls == calls

    # Sube zustand y se quita left-pad: solo se reindexa zustand.
    request_data(tmp_path, [{"package": "zustand", "ecosystem": "npm", "version": "5.0.3"}])
    r = index_project(tmp_path, http=http, store=store, embedder=emb)
    assert r["reindexed"] == ["npm:zustand"] and r["deleted"] == ["npm:left-pad"]
    assert store.count_chunks("npm", "zustand") == 1
    assert {p["payload"]["version"] for p in store.points.values()} == {"5.0.3"}
    assert list(inventory(tmp_path)["packages"]) == ["npm:zustand"]


def test_no_request_stops_with_a_message(tmp_path):
    import pytest

    with pytest.raises(SystemExit, match="request.json"):
        index_project(tmp_path, http=FakeHttp({}), store=FakeStore(), embedder=FakeEmbedder())


def test_drop_uses_the_inventory_collection(tmp_path):
    (tmp_path / ".docs-rag").mkdir()
    (tmp_path / ".docs-rag" / "inventory.json").write_text('{"collection": "docs_abc"}', encoding="utf-8")
    store = FakeStore()
    store.ensure(3)
    assert drop(tmp_path, store=store) == {"collection": "docs_abc", "deleted": True}


def test_read_token_from_the_project_env(tmp_path, monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    assert read_token(tmp_path) is None
    (tmp_path / ".env").write_text("OTRO=1\nexport GITHUB_TOKEN=\"ghp_x\"  # comentario\n", encoding="utf-8")
    assert read_token(tmp_path) == "ghp_x"
    (tmp_path / ".env").write_text("GITHUB_TOKEN=ghp_y # nota\n", encoding="utf-8")
    assert read_token(tmp_path) == "ghp_y"


SPANISH_KEYS = {"paquete", "paquetes", "ecosistema", "origen", "fuente", "tipo_doc", "ruta_titulos", "texto", "tiene_codigo", "simbolos", "coleccion", "estado", "indexado", "indexados", "sin_doc", "motivo", "filtros", "huella", "fragmentos", "truncados", "avisos"}


def _keys(field_value):
    if isinstance(field_value, dict):
        for k, v in field_value.items():
            yield k
            yield from _keys(v)
    elif isinstance(field_value, list):
        for v in field_value:
            yield from _keys(v)


def test_inventory_summary_and_payload_in_english(tmp_path):
    store = FakeStore()
    request_data(tmp_path, [{"package": "zustand", "ecosystem": "npm", "version": "5.0.2"}, {"package": "left-pad", "ecosystem": "npm", "version": "1.3.0"}])
    summary = index_project(tmp_path, http=FakeHttp(NPM), store=store, embedder=FakeEmbedder())
    inv = inventory(tmp_path)
    payloads = [p["payload"] for p in store.points.values()]
    used = set(_keys(summary)) | set(_keys(inv)) | set(_keys(payloads))
    assert not used & SPANISH_KEYS
    assert inv["packages"]["npm:zustand"]["status"] == "indexed"
    assert inv["packages"]["npm:left-pad"]["status"] == "no_docs"
    assert {"package", "ecosystem", "doc_type", "source", "heading_path", "text", "has_code"} <= set(payloads[0])


def test_migrates_the_legacy_index(tmp_path):
    folder = tmp_path / ".docs-rag"
    folder.mkdir()
    (folder / "inventario.json").write_text('{"coleccion": "docs_viejo", "paquetes": {}}', encoding="utf-8")
    (folder / "peticion.json").write_text('{"paquetes": []}', encoding="utf-8")
    request_data(tmp_path, [{"package": "zustand", "ecosystem": "npm", "version": "5.0.2"}])
    opened = []

    def open_store(name):
        opened.append(name)
        stale = FakeStore()
        stale.ensure(3)
        return stale

    r = index_project(tmp_path, http=FakeHttp(NPM), store=FakeStore(), embedder=FakeEmbedder(), open_store=open_store)
    assert opened == ["docs_viejo"]
    assert not (folder / "inventario.json").exists() and not (folder / "peticion.json").exists()
    assert r["indexed"] == ["npm:zustand"] and r["collection"].startswith("docs_v2_")
    assert any("docs_viejo" in a for a in r["warnings"])
