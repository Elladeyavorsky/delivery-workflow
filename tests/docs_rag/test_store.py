from pathlib import Path

from docs_rag.store import OllamaEmbedder, chunk_id, collection_name, reindex_plan


def test_plan_reindexes_only_what_changed():
    """Escenario 3: sube la versión de una librería, otra desaparece, otra es nueva y el resto queda igual."""
    current = {
        "npm:react": {"package": "react", "ecosystem": "npm", "version": "18.3.1", "status": "indexed"},
        "npm:zod": {"package": "zod", "ecosystem": "npm", "version": "3.23.8", "status": "indexed"},
        "python:requests": {"package": "requests", "ecosystem": "python", "version": "2.32.3", "status": "indexed"},
        "npm:left-pad": {"package": "left-pad", "ecosystem": "npm", "version": "1.3.0", "status": "no_docs", "reason": "npm no tiene left-pad"},
        "npm:axios": {"package": "axios", "ecosystem": "npm", "version": "1.7.0", "status": "no_docs", "reason": "Error al descargar la documentación: timeout"},
    }
    requested = [
        {"package": "react", "ecosystem": "npm", "version": "19.0.0"},
        {"package": "zod", "ecosystem": "npm", "version": "3.23.8"},
        {"package": "left-pad", "ecosystem": "npm", "version": "1.3.0"},
        {"package": "axios", "ecosystem": "npm", "version": "1.7.0"},
        {"package": "httpx", "ecosystem": "python", "version": "0.28.1"},
    ]
    plan = reindex_plan(requested, current)
    assert plan == {"index": ["python:httpx"], "reindex": ["npm:react", "npm:axios"], "delete": ["python:requests"], "unchanged": ["npm:zod", "npm:left-pad"]}
    assert reindex_plan(requested[1:3], {k: current[k] for k in ("npm:zod", "npm:left-pad")}) == {"index": [], "reindex": [], "delete": [], "unchanged": ["npm:zod", "npm:left-pad"]}


def test_stable_ids_and_one_collection_per_project(tmp_path):
    a = chunk_id("npm", "react", "19.0.0", "reference/hooks.md", 3)
    assert a == chunk_id("npm", "react", "19.0.0", "reference/hooks.md", 3)
    assert a != chunk_id("npm", "react", "19.0.1", "reference/hooks.md", 3)
    assert a != chunk_id("python", "react", "19.0.0", "reference/hooks.md", 3)
    one, other = tmp_path / "uno", tmp_path / "otro"
    assert collection_name(one) == collection_name(Path(str(one) + "/."))
    assert collection_name(one) != collection_name(other)
    assert collection_name(one).startswith("docs_v2_") and len(collection_name(one)) == 20


def test_embedder_adds_nomic_prefixes_and_works_in_batches():
    class FakeClient:
        def __init__(self):
            self.entries = []

        def embed(self, model, input):
            self.entries.append(list(input))
            return {"embeddings": [[1.0] for _ in input]}

    client = FakeClient()
    e = OllamaEmbedder(client=client)
    assert len(e.documents([f"t{i}" for i in range(40)])) == 40
    assert [len(x) for x in client.entries] == [32, 8]
    assert client.entries[0][0] == "search_document: t0"
    e.question("How?")
    assert client.entries[-1] == ["search_query: How?"]
