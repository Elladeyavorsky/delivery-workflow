import ast
from pathlib import Path

SERVER = Path(__file__).resolve().parents[2] / ".apm" / "skills" / "setup-docs-rag" / "scripts" / "docs_rag" / "docs_rag" / "server.py"


def _tools():
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    return {
        f.name: [a.arg for a in f.args.args]
        for f in tree.body
        if isinstance(f, ast.FunctionDef) and any(isinstance(d, ast.Call) and getattr(d.func, "attr", "") == "tool" for d in f.decorator_list)
    }


def test_mcp_tools_in_english():
    assert _tools() == {"resolve_package": ["name"], "query_docs": ["package", "question", "filters", "k"]}
