import json

import pytest
from falsos import BuscadorFalso, EmbebedorFalso, ReordenadorFalso

from docs_rag.consulta import ConsultaNoValida, Consultor, SinIndice

INVENTARIO = {
    "coleccion": "docs_x",
    "paquetes": {
        "npm:react": {"paquete": "react", "ecosistema": "npm", "version": "19.0.0", "estado": "indexado", "tipo_doc": "markdown", "filtros": ["tiene_codigo", "deprecated", "simbolos", "tipo_pagina", "lenguaje_codigo"], "fragmentos": 3},
        "runtime:node": {"paquete": "node", "ecosistema": "runtime", "version": "22.11.0", "estado": "indexado", "tipo_doc": "node", "filtros": ["tiene_codigo", "deprecated", "modulo", "simbolos", "added_in", "estabilidad"], "fragmentos": 2},
        "npm:left-pad": {"paquete": "left-pad", "ecosistema": "npm", "version": "1.3.0", "estado": "sin_doc", "motivo": "npm no tiene left-pad 1.3.0"},
        "python:react": {"paquete": "react", "ecosistema": "python", "version": "0.1", "estado": "indexado", "tipo_doc": "generico", "filtros": ["tiene_codigo", "deprecated"]},
    },
}

CANDIDATOS = [
    {"paquete": "react", "ecosistema": "npm", "texto": "useState returns a stateful value", "simbolos": ["useState"], "fuente": "hooks.md"},
    {"paquete": "react", "ecosistema": "npm", "texto": "useEffect runs after render", "simbolos": ["useEffect"], "fuente": "effects.md"},
    {"paquete": "react", "ecosistema": "npm", "texto": "Components are functions", "simbolos": ["Component"], "fuente": "learn.md"},
    {"paquete": "node", "ecosistema": "runtime", "texto": "fs.readFile reads a file", "modulo": "node:fs", "fuente": "fs.md"},
]


def proyecto(tmp_path, inventario=INVENTARIO):
    carpeta = tmp_path / ".docs-rag"
    carpeta.mkdir()
    (carpeta / "inventario.json").write_text(json.dumps(inventario), encoding="utf-8")
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
    r = c.resolver_paquete("React")["paquetes"]
    assert [p["paquete"] for p in r] == ["npm:react", "python:react"]
    assert r[0]["filtros"][:2] == ["tiene_codigo", "deprecated"] and r[0]["tipo_doc"] == "markdown"
    assert c.resolver_paquete("npm:react")["paquetes"][0]["version"] == "19.0.0"
    assert c.resolver_paquete("left_pad")["paquetes"][0]["sin_doc"] == "npm no tiene left-pad 1.3.0"
    assert "Indexados:" in c.resolver_paquete("vue")["aviso"]


def test_consultar_filtra_por_paquete_y_reordena(tmp_path):
    c, buscador = consultor(proyecto(tmp_path))
    r = c.consultar_docs("npm:react", "how does useState returns value", k=2)
    assert r["version"] == "19.0.0" and r["filtrado"] is False
    assert [x["fuente"] for x in r["resultados"]] == ["hooks.md", "effects.md"]
    assert buscador.llamadas == [{"ecosistema": "npm", "paquete": "react"}]
    assert "score_reranking" in r["resultados"][0]


def test_filtros_validos_y_repeticion_sin_filtros(tmp_path):
    c, buscador = consultor(proyecto(tmp_path))
    r = c.consultar_docs("npm:react", "useEffect runs after render", {"simbolos": "useEffect"})
    assert r["filtrado"] is True and r["resultados"][0]["fuente"] == "effects.md"
    r = c.consultar_docs("npm:react", "useState returns a stateful value", {"simbolos": ["Component"]})
    assert r["filtrado"] is False, "ningún candidato filtrado llega al umbral: se repite sin filtros"
    assert r["resultados"][0]["fuente"] == "hooks.md"
    assert buscador.llamadas[-2:] == [{"ecosistema": "npm", "paquete": "react", "simbolos": ["Component"]}, {"ecosistema": "npm", "paquete": "react"}]


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
    with pytest.raises(ConsultaNoValida, match="resolver_paquete"):
        c.consultar_docs("vue", "x")
    with pytest.raises(ConsultaNoValida, match="vacía"):
        c.consultar_docs("npm:react", "  ")
    with pytest.raises(ConsultaNoValida, match="k va de 1"):
        c.consultar_docs("npm:react", "x", k=0)
