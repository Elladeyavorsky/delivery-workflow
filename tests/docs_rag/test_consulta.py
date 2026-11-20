import json

import pytest
from falsos import BuscadorFalso, EmbebedorFalso, ReordenadorFalso

from docs_rag.consulta import ConsultaNoValida, Consultor, SinIndice

INVENTARIO = {
    "collection": "docs_x",
    "packages": {
        "npm:react": {"package": "react", "ecosystem": "npm", "version": "19.0.0", "status": "indexed", "doc_type": "markdown", "filters": ["has_code", "deprecated", "symbols", "page_type", "code_language"], "chunks": 3},
        "runtime:node": {"package": "node", "ecosystem": "runtime", "version": "22.11.0", "status": "indexed", "doc_type": "node", "filters": ["has_code", "deprecated", "module", "symbols", "added_in", "stability"], "chunks": 2},
        "npm:left-pad": {"package": "left-pad", "ecosystem": "npm", "version": "1.3.0", "status": "no_docs", "reason": "npm no tiene left-pad 1.3.0"},
        "python:react": {"package": "react", "ecosystem": "python", "version": "0.1", "status": "indexed", "doc_type": "generic", "filters": ["has_code", "deprecated"]},
    },
}

CANDIDATOS = [
    {"package": "react", "ecosystem": "npm", "text": "useState returns a stateful value", "symbols": ["useState"], "source": "hooks.md"},
    {"package": "react", "ecosystem": "npm", "text": "useEffect runs after render", "symbols": ["useEffect"], "source": "effects.md"},
    {"package": "react", "ecosystem": "npm", "text": "Components are functions", "symbols": ["Component"], "source": "learn.md"},
    {"package": "node", "ecosystem": "runtime", "text": "fs.readFile reads a file", "module": "node:fs", "source": "fs.md"},
]


def proyecto(tmp_path, inventario=INVENTARIO):
    carpeta = tmp_path / ".docs-rag"
    carpeta.mkdir()
    (carpeta / "inventory.json").write_text(json.dumps(inventario), encoding="utf-8")
    sub = tmp_path / "src" / "app"
    sub.mkdir(parents=True)
    return sub


def consultor(inicio, candidatos=CANDIDATOS):
    buscador = BuscadorFalso(candidatos)
    return Consultor(inicio, buscador=buscador, embebedor=EmbebedorFalso(), reordenador=ReordenadorFalso()), buscador


def test_sin_indice_da_error_explicito(tmp_path):
    """Escenario 5: el servidor arranca, pero sin índice las herramientas dicen qué hacer."""
    c, _ = consultor(tmp_path)
    with pytest.raises(SinIndice, match="/setup-docs-rag"):
        c.resolver_paquete("react")
    with pytest.raises(SinIndice, match="/setup-docs-rag"):
        c.consultar_docs("react", "How does useState work?")


def test_resolver_paquete_desde_una_subcarpeta(tmp_path):
    c, _ = consultor(proyecto(tmp_path))
    r = c.resolver_paquete("React")["packages"]
    assert [p["package"] for p in r] == ["npm:react", "python:react"]
    assert r[0]["filters"][:2] == ["has_code", "deprecated"] and r[0]["doc_type"] == "markdown"
    assert c.resolver_paquete("npm:react")["packages"][0]["version"] == "19.0.0"
    assert c.resolver_paquete("left_pad")["packages"][0]["no_docs"] == "npm no tiene left-pad 1.3.0"
    assert "Indexados:" in c.resolver_paquete("vue")["warning"]


def test_consultar_filtra_por_paquete_y_reordena(tmp_path):
    c, buscador = consultor(proyecto(tmp_path))
    r = c.consultar_docs("npm:react", "how does useState returns value", k=2)
    assert r["version"] == "19.0.0" and r["filtered"] is False
    assert [x["source"] for x in r["results"]] == ["hooks.md", "effects.md"]
    assert buscador.llamadas == [{"ecosystem": "npm", "package": "react"}]
    assert "rerank_score" in r["results"][0]


def test_filtros_validos_y_repeticion_sin_filtros(tmp_path):
    c, buscador = consultor(proyecto(tmp_path))
    r = c.consultar_docs("npm:react", "useEffect runs after render", {"symbols": "useEffect"})
    assert r["filtered"] is True and r["results"][0]["source"] == "effects.md"
    r = c.consultar_docs("npm:react", "useState returns a stateful value", {"symbols": ["Component"]})
    assert r["filtered"] is False, "ningún candidato filtrado llega al umbral: se repite sin filtros"
    assert r["results"][0]["source"] == "hooks.md"
    assert buscador.llamadas[-2:] == [{"ecosystem": "npm", "package": "react", "symbols": ["Component"]}, {"ecosystem": "npm", "package": "react"}]


def test_consultas_no_validas(tmp_path):
    c, _ = consultor(proyecto(tmp_path))
    with pytest.raises(ConsultaNoValida, match="varios ecosistemas"):
        c.consultar_docs("react", "x")
    with pytest.raises(ConsultaNoValida, match="Filtros no válidos.*added_in"):
        c.consultar_docs("npm:react", "x", {"added_in": "18"})
    with pytest.raises(ConsultaNoValida, match="verdadero o falso"):
        c.consultar_docs("npm:react", "x", {"deprecated": "yes"})
    with pytest.raises(ConsultaNoValida, match="no tiene documentación indexada"):
        c.consultar_docs("left-pad", "x")
    with pytest.raises(ConsultaNoValida, match="resolve_package"):
        c.consultar_docs("vue", "x")
    with pytest.raises(ConsultaNoValida, match="vacía"):
        c.consultar_docs("npm:react", "  ")
    with pytest.raises(ConsultaNoValida, match="k va de 1"):
        c.consultar_docs("npm:react", "x", k=0)
