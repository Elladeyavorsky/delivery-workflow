import json

import pytest
from fakes import FakeSearcher, FakeEmbedder, FakeReranker

from docs_rag.lookup import InvalidQuery, DocsLookup, NoIndex

INVENTORY = {
    "collection": "docs_x",
    "packages": {
        "npm:react": {"package": "react", "ecosystem": "npm", "version": "19.0.0", "status": "indexed", "doc_type": "markdown", "filters": ["has_code", "deprecated", "symbols", "page_type", "code_language"], "chunks": 3},
        "runtime:node": {"package": "node", "ecosystem": "runtime", "version": "22.11.0", "status": "indexed", "doc_type": "node", "filters": ["has_code", "deprecated", "module", "symbols", "added_in", "stability"], "chunks": 2},
        "npm:left-pad": {"package": "left-pad", "ecosystem": "npm", "version": "1.3.0", "status": "no_docs", "reason": "npm no tiene left-pad 1.3.0"},
        "python:react": {"package": "react", "ecosystem": "python", "version": "0.1", "status": "indexed", "doc_type": "generic", "filters": ["has_code", "deprecated"]},
    },
}

CANDIDATES = [
    {"package": "react", "ecosystem": "npm", "text": "useState returns a stateful value", "symbols": ["useState"], "source": "hooks.md"},
    {"package": "react", "ecosystem": "npm", "text": "useEffect runs after render", "symbols": ["useEffect"], "source": "effects.md"},
    {"package": "react", "ecosystem": "npm", "text": "Components are functions", "symbols": ["Component"], "source": "learn.md"},
    {"package": "node", "ecosystem": "runtime", "text": "fs.readFile reads a file", "module": "node:fs", "source": "fs.md"},
]


def project(tmp_path, inventory=INVENTORY):
    folder = tmp_path / ".docs-rag"
    folder.mkdir()
    (folder / "inventory.json").write_text(json.dumps(inventory), encoding="utf-8")
    sub = tmp_path / "src" / "app"
    sub.mkdir(parents=True)
    return sub


def docs_lookup(start, candidates=CANDIDATES):
    searcher = FakeSearcher(candidates)
    return DocsLookup(start, searcher=searcher, embedder=FakeEmbedder(), reranker=FakeReranker()), searcher


def test_no_index_gives_a_clear_error(tmp_path):
    """Escenario 5: el servidor arranca, pero sin índice las herramientas dicen qué hacer."""
    c, _ = docs_lookup(tmp_path)
    with pytest.raises(NoIndex, match="/setup-docs-rag"):
        c.resolve_package("react")
    with pytest.raises(NoIndex, match="/setup-docs-rag"):
        c.query_docs("react", "How does useState work?")


def test_resolve_package_from_a_subfolder(tmp_path):
    c, _ = docs_lookup(project(tmp_path))
    r = c.resolve_package("React")["packages"]
    assert [p["package"] for p in r] == ["npm:react", "python:react"]
    assert r[0]["filters"][:2] == ["has_code", "deprecated"] and r[0]["doc_type"] == "markdown"
    assert c.resolve_package("npm:react")["packages"][0]["version"] == "19.0.0"
    assert c.resolve_package("left_pad")["packages"][0]["no_docs"] == "npm no tiene left-pad 1.3.0"
    assert "Indexados:" in c.resolve_package("vue")["warning"]


def test_query_filters_by_package_and_reranks(tmp_path):
    c, searcher = docs_lookup(project(tmp_path))
    r = c.query_docs("npm:react", "how does useState returns value", k=2)
    assert r["version"] == "19.0.0" and r["filtered"] is False
    assert [x["source"] for x in r["results"]] == ["hooks.md", "effects.md"]
    assert searcher.calls == [{"ecosystem": "npm", "package": "react"}]
    assert "rerank_score" in r["results"][0]


def test_valid_filters_and_retry_without_filters(tmp_path):
    c, searcher = docs_lookup(project(tmp_path))
    r = c.query_docs("npm:react", "useEffect runs after render", {"symbols": "useEffect"})
    assert r["filtered"] is True and r["results"][0]["source"] == "effects.md"
    r = c.query_docs("npm:react", "useState returns a stateful value", {"symbols": ["Component"]})
    assert r["filtered"] is False, "ningún candidato filtrado llega al umbral: se repite sin filtros"
    assert r["results"][0]["source"] == "hooks.md"
    assert searcher.calls[-2:] == [{"ecosystem": "npm", "package": "react", "symbols": ["Component"]}, {"ecosystem": "npm", "package": "react"}]


def test_invalid_queries(tmp_path):
    c, _ = docs_lookup(project(tmp_path))
    with pytest.raises(InvalidQuery, match="varios ecosistemas"):
        c.query_docs("react", "x")
    with pytest.raises(InvalidQuery, match="Filtros no válidos.*added_in"):
        c.query_docs("npm:react", "x", {"added_in": "18"})
    with pytest.raises(InvalidQuery, match="verdadero o falso"):
        c.query_docs("npm:react", "x", {"deprecated": "yes"})
    with pytest.raises(InvalidQuery, match="no tiene documentación indexada"):
        c.query_docs("left-pad", "x")
    with pytest.raises(InvalidQuery, match="resolve_package"):
        c.query_docs("vue", "x")
    with pytest.raises(InvalidQuery, match="vacía"):
        c.query_docs("npm:react", "  ")
    with pytest.raises(InvalidQuery, match="k va de 1"):
        c.query_docs("npm:react", "x", k=0)
