import sys
from pathlib import Path

# El paquete Python de la skill setup-docs-rag, importable sin instalarlo.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".apm" / "skills" / "setup-docs-rag" / "scripts" / "docs_rag"))
