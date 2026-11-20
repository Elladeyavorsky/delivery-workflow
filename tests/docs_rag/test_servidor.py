import ast
from pathlib import Path

SERVIDOR = Path(__file__).resolve().parents[2] / ".apm" / "skills" / "setup-docs-rag" / "scripts" / "docs_rag" / "docs_rag" / "servidor.py"


def _herramientas():
    arbol = ast.parse(SERVIDOR.read_text(encoding="utf-8"))
    return {
        f.name: [a.arg for a in f.args.args]
        for f in arbol.body
        if isinstance(f, ast.FunctionDef) and any(isinstance(d, ast.Call) and getattr(d.func, "attr", "") == "tool" for d in f.decorator_list)
    }


def test_herramientas_del_mcp_en_ingles():
    assert _herramientas() == {"resolve_package": ["name"], "query_docs": ["package", "question", "filters", "k"]}
