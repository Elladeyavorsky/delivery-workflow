import json

from falsos import EmbebedorFalso, HttpFalso, IndiceFalso

from docs_rag.indexar import borrar, ejecutar, leer_token

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


def peticion(raiz, paquetes):
    carpeta = raiz / ".docs-rag"
    carpeta.mkdir(exist_ok=True)
    (carpeta / "request.json").write_text(json.dumps({"packages": paquetes}), encoding="utf-8")


def inventario(raiz):
    return json.loads((raiz / ".docs-rag" / "inventory.json").read_text(encoding="utf-8"))


def test_indexa_reindexa_y_borra_solo_lo_cambiado(tmp_path):
    indice, emb = IndiceFalso(), EmbebedorFalso()
    http = HttpFalso(NPM)
    peticion(tmp_path, [{"package": "zustand", "ecosystem": "npm", "version": "5.0.2"}, {"package": "left-pad", "ecosystem": "npm", "version": "1.3.0"}])
    r = ejecutar(tmp_path, http=http, indice=indice, embebedor=emb)
    assert r["indexed"] == ["npm:zustand"] and r["no_docs"][0]["package"] == "npm:left-pad"
    inv = inventario(tmp_path)
    z = inv["packages"]["npm:zustand"]
    assert z["status"] == "indexed" and z["doc_type"] == "markdown" and z["chunks"] == indice.contar("npm", "zustand") == 2
    assert "symbols" in z["filters"] and z["origin"].endswith("/tree/abc")
    assert inv["packages"]["npm:left-pad"]["status"] == "no_docs"
    assert (tmp_path / ".docs-rag" / "docs" / "npm_zustand" / "docs" / "apis" / "create.md").is_file()
    payload = next(p["payload"] for p in indice.puntos.values() if p["payload"]["source"] == "docs/guides/slices.md")
    assert payload["has_code"] is True and payload["version"] == "5.0.2" and payload["heading_path"] == "Slices"

    # Sin cambios: no se descarga ni se embebe nada.
    pedidas, llamadas = len(http.pedidas), emb.llamadas
    r = ejecutar(tmp_path, http=http, indice=indice, embebedor=emb)
    assert r["unchanged"] == ["npm:zustand", "npm:left-pad"] and r["indexed"] == r["reindexed"] == []
    assert len(http.pedidas) == pedidas and emb.llamadas == llamadas

    # Sube zustand y se quita left-pad: solo se reindexa zustand.
    peticion(tmp_path, [{"package": "zustand", "ecosystem": "npm", "version": "5.0.3"}])
    r = ejecutar(tmp_path, http=http, indice=indice, embebedor=emb)
    assert r["reindexed"] == ["npm:zustand"] and r["deleted"] == ["npm:left-pad"]
    assert indice.contar("npm", "zustand") == 1
    assert {p["payload"]["version"] for p in indice.puntos.values()} == {"5.0.3"}
    assert list(inventario(tmp_path)["packages"]) == ["npm:zustand"]


def test_sin_peticion_para_con_mensaje(tmp_path):
    import pytest

    with pytest.raises(SystemExit, match="request.json"):
        ejecutar(tmp_path, http=HttpFalso({}), indice=IndiceFalso(), embebedor=EmbebedorFalso())


def test_borrar_usa_la_coleccion_del_inventario(tmp_path):
    (tmp_path / ".docs-rag").mkdir()
    (tmp_path / ".docs-rag" / "inventory.json").write_text('{"collection": "docs_abc"}', encoding="utf-8")
    indice = IndiceFalso()
    indice.asegurar(3)
    assert borrar(tmp_path, indice=indice) == {"collection": "docs_abc", "deleted": True}


def test_leer_token_del_env_del_proyecto(tmp_path, monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    assert leer_token(tmp_path) is None
    (tmp_path / ".env").write_text("OTRO=1\nexport GITHUB_TOKEN=\"ghp_x\"  # comentario\n", encoding="utf-8")
    assert leer_token(tmp_path) == "ghp_x"
    (tmp_path / ".env").write_text("GITHUB_TOKEN=ghp_y # nota\n", encoding="utf-8")
    assert leer_token(tmp_path) == "ghp_y"


CLAVES_EN_ESPANOL = {"paquete", "paquetes", "ecosistema", "origen", "fuente", "tipo_doc", "ruta_titulos", "texto", "tiene_codigo", "simbolos", "coleccion", "estado", "indexado", "indexados", "sin_doc", "motivo", "filtros", "huella", "fragmentos", "truncados", "avisos"}


def _claves(valor):
    if isinstance(valor, dict):
        for k, v in valor.items():
            yield k
            yield from _claves(v)
    elif isinstance(valor, list):
        for v in valor:
            yield from _claves(v)


def test_inventario_resumen_y_payload_en_ingles(tmp_path):
    indice = IndiceFalso()
    peticion(tmp_path, [{"package": "zustand", "ecosystem": "npm", "version": "5.0.2"}, {"package": "left-pad", "ecosystem": "npm", "version": "1.3.0"}])
    resumen = ejecutar(tmp_path, http=HttpFalso(NPM), indice=indice, embebedor=EmbebedorFalso())
    inv = inventario(tmp_path)
    payloads = [p["payload"] for p in indice.puntos.values()]
    usadas = set(_claves(resumen)) | set(_claves(inv)) | set(_claves(payloads))
    assert not usadas & CLAVES_EN_ESPANOL
    assert inv["packages"]["npm:zustand"]["status"] == "indexed"
    assert inv["packages"]["npm:left-pad"]["status"] == "no_docs"
    assert {"package", "ecosystem", "doc_type", "source", "heading_path", "text", "has_code"} <= set(payloads[0])


def test_migra_el_indice_del_formato_anterior(tmp_path):
    carpeta = tmp_path / ".docs-rag"
    carpeta.mkdir()
    (carpeta / "inventario.json").write_text('{"coleccion": "docs_viejo", "paquetes": {}}', encoding="utf-8")
    (carpeta / "peticion.json").write_text('{"paquetes": []}', encoding="utf-8")
    peticion(tmp_path, [{"package": "zustand", "ecosystem": "npm", "version": "5.0.2"}])
    abiertas = []

    def abrir_indice(nombre):
        abiertas.append(nombre)
        viejo = IndiceFalso()
        viejo.asegurar(3)
        return viejo

    r = ejecutar(tmp_path, http=HttpFalso(NPM), indice=IndiceFalso(), embebedor=EmbebedorFalso(), abrir_indice=abrir_indice)
    assert abiertas == ["docs_viejo"]
    assert not (carpeta / "inventario.json").exists() and not (carpeta / "peticion.json").exists()
    assert r["indexed"] == ["npm:zustand"] and r["collection"].startswith("docs_v2_")
    assert any("docs_viejo" in a for a in r["warnings"])
