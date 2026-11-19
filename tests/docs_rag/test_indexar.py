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
    (carpeta / "peticion.json").write_text(json.dumps({"paquetes": paquetes}), encoding="utf-8")


def inventario(raiz):
    return json.loads((raiz / ".docs-rag" / "inventario.json").read_text(encoding="utf-8"))


def test_indexa_reindexa_y_borra_solo_lo_cambiado(tmp_path):
    indice, emb = IndiceFalso(), EmbebedorFalso()
    http = HttpFalso(NPM)
    peticion(tmp_path, [{"paquete": "zustand", "ecosistema": "npm", "version": "5.0.2"}, {"paquete": "left-pad", "ecosistema": "npm", "version": "1.3.0"}])
    r = ejecutar(tmp_path, http=http, indice=indice, embebedor=emb)
    assert r["indexados"] == ["npm:zustand"] and r["sin_doc"][0]["paquete"] == "npm:left-pad"
    inv = inventario(tmp_path)
    z = inv["paquetes"]["npm:zustand"]
    assert z["estado"] == "indexado" and z["tipo_doc"] == "markdown" and z["fragmentos"] == indice.contar("npm", "zustand") == 2
    assert "simbolos" in z["filtros"] and z["origen"].endswith("/tree/abc")
    assert inv["paquetes"]["npm:left-pad"]["estado"] == "sin_doc"
    assert (tmp_path / ".docs-rag" / "docs" / "npm_zustand" / "docs" / "apis" / "create.md").is_file()
    payload = next(p["payload"] for p in indice.puntos.values() if p["payload"]["fuente"] == "docs/guides/slices.md")
    assert payload["tiene_codigo"] is True and payload["version"] == "5.0.2" and payload["ruta_titulos"] == "Slices"

    # Sin cambios: no se descarga ni se embebe nada.
    pedidas, llamadas = len(http.pedidas), emb.llamadas
    r = ejecutar(tmp_path, http=http, indice=indice, embebedor=emb)
    assert r["iguales"] == ["npm:zustand", "npm:left-pad"] and r["indexados"] == r["reindexados"] == []
    assert len(http.pedidas) == pedidas and emb.llamadas == llamadas

    # Sube zustand y se quita left-pad: solo se reindexa zustand.
    peticion(tmp_path, [{"paquete": "zustand", "ecosistema": "npm", "version": "5.0.3"}])
    r = ejecutar(tmp_path, http=http, indice=indice, embebedor=emb)
    assert r["reindexados"] == ["npm:zustand"] and r["borrados"] == ["npm:left-pad"]
    assert indice.contar("npm", "zustand") == 1
    assert {p["payload"]["version"] for p in indice.puntos.values()} == {"5.0.3"}
    assert list(inventario(tmp_path)["paquetes"]) == ["npm:zustand"]


def test_sin_peticion_para_con_mensaje(tmp_path):
    import pytest

    with pytest.raises(SystemExit, match="peticion.json"):
        ejecutar(tmp_path, http=HttpFalso({}), indice=IndiceFalso(), embebedor=EmbebedorFalso())


def test_borrar_usa_la_coleccion_del_inventario(tmp_path):
    (tmp_path / ".docs-rag").mkdir()
    (tmp_path / ".docs-rag" / "inventario.json").write_text('{"coleccion": "docs_abc"}', encoding="utf-8")
    indice = IndiceFalso()
    indice.asegurar(3)
    assert borrar(tmp_path, indice=indice) == {"coleccion": "docs_abc", "borrada": True}


def test_leer_token_del_env_del_proyecto(tmp_path, monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    assert leer_token(tmp_path) is None
    (tmp_path / ".env").write_text("OTRO=1\nexport GITHUB_TOKEN=\"ghp_x\"  # comentario\n", encoding="utf-8")
    assert leer_token(tmp_path) == "ghp_x"
    (tmp_path / ".env").write_text("GITHUB_TOKEN=ghp_y # nota\n", encoding="utf-8")
    assert leer_token(tmp_path) == "ghp_y"
