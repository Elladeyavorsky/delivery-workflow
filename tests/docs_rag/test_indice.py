from pathlib import Path

from docs_rag.indice import EmbebedorOllama, id_fragmento, nombre_coleccion, plan_reindexado


def test_plan_reindexa_solo_lo_cambiado():
    """Escenario 3: sube la versión de una librería, otra desaparece, otra es nueva y el resto queda igual."""
    actual = {
        "npm:react": {"paquete": "react", "ecosistema": "npm", "version": "18.3.1", "estado": "indexado"},
        "npm:zod": {"paquete": "zod", "ecosistema": "npm", "version": "3.23.8", "estado": "indexado"},
        "python:requests": {"paquete": "requests", "ecosistema": "python", "version": "2.32.3", "estado": "indexado"},
        "npm:left-pad": {"paquete": "left-pad", "ecosistema": "npm", "version": "1.3.0", "estado": "sin_doc", "motivo": "npm no tiene left-pad"},
        "npm:axios": {"paquete": "axios", "ecosistema": "npm", "version": "1.7.0", "estado": "sin_doc", "motivo": "Error al descargar la documentación: timeout"},
    }
    pedido = [
        {"paquete": "react", "ecosistema": "npm", "version": "19.0.0"},
        {"paquete": "zod", "ecosistema": "npm", "version": "3.23.8"},
        {"paquete": "left-pad", "ecosistema": "npm", "version": "1.3.0"},
        {"paquete": "axios", "ecosistema": "npm", "version": "1.7.0"},
        {"paquete": "httpx", "ecosistema": "python", "version": "0.28.1"},
    ]
    plan = plan_reindexado(pedido, actual)
    assert plan == {"indexar": ["python:httpx"], "reindexar": ["npm:react", "npm:axios"], "borrar": ["python:requests"], "igual": ["npm:zod", "npm:left-pad"]}
    assert plan_reindexado(pedido[1:3], {k: actual[k] for k in ("npm:zod", "npm:left-pad")}) == {"indexar": [], "reindexar": [], "borrar": [], "igual": ["npm:zod", "npm:left-pad"]}


def test_ids_estables_y_coleccion_por_proyecto(tmp_path):
    a = id_fragmento("npm", "react", "19.0.0", "reference/hooks.md", 3)
    assert a == id_fragmento("npm", "react", "19.0.0", "reference/hooks.md", 3)
    assert a != id_fragmento("npm", "react", "19.0.1", "reference/hooks.md", 3)
    assert a != id_fragmento("python", "react", "19.0.0", "reference/hooks.md", 3)
    uno, otro = tmp_path / "uno", tmp_path / "otro"
    assert nombre_coleccion(uno) == nombre_coleccion(Path(str(uno) + "/."))
    assert nombre_coleccion(uno) != nombre_coleccion(otro)
    assert nombre_coleccion(uno).startswith("docs_") and len(nombre_coleccion(uno)) == 17


def test_embebedor_pone_los_prefijos_de_nomic_y_trabaja_por_lotes():
    class Cliente:
        def __init__(self):
            self.entradas = []

        def embed(self, model, input):
            self.entradas.append(list(input))
            return {"embeddings": [[1.0] for _ in input]}

    cliente = Cliente()
    e = EmbebedorOllama(cliente=cliente)
    assert len(e.documentos([f"t{i}" for i in range(40)])) == 40
    assert [len(x) for x in cliente.entradas] == [32, 8]
    assert cliente.entradas[0][0] == "search_document: t0"
    e.pregunta("How?")
    assert cliente.entradas[-1] == ["search_query: How?"]
