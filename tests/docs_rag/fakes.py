"""Dobles de prueba: red, Qdrant, embeddings y reordenador, sin servicios ni modelos."""

import io
import json
import urllib.error
import zipfile


class FakeHttp:
    """Responde según un diccionario url → bytes|str|dict; el resto da 404. Guarda las URLs pedidas."""

    def __init__(self, responses: dict):
        self.responses = responses
        self.requested_keys: list[str] = []
        self.requested_headers: list[dict] = []

    def __call__(self, url, request_headers=None, timeout=120):
        self.requested_keys.append(url)
        self.requested_headers.append(dict(request_headers or {}))
        if url not in self.responses:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        r = self.responses[url]
        if isinstance(r, Exception):
            raise r
        if isinstance(r, (dict, list)):
            return json.dumps(r).encode()
        return r.encode() if isinstance(r, str) else r


def zip_with(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in files.items():
            z.writestr(name, text)
    return buf.getvalue()


class FakeStore:
    def __init__(self):
        self.points: dict[str, dict] = {}
        self.dimension = None
        self.deleted: list[tuple[str, str]] = []

    def ensure(self, dimension):
        self.dimension = dimension

    def has_collection(self):
        return self.dimension is not None

    def delete_package(self, ecosystem, package):
        self.deleted.append((ecosystem, package))
        self.points = {i: p for i, p in self.points.items() if not (p["payload"]["ecosystem"] == ecosystem and p["payload"]["package"] == package)}

    def upload(self, points):
        for p in points:
            self.points[p["id"]] = p

    def count_chunks(self, ecosystem=None, package=None):
        return sum(1 for p in self.points.values() if (not ecosystem or p["payload"]["ecosystem"] == ecosystem) and (not package or p["payload"]["package"] == package))

    def drop_collection(self):
        existed = self.has_collection()
        self.points, self.dimension = {}, None
        return existed


class FakeEmbedder:
    def __init__(self):
        self.calls = 0

    def documents(self, texts):
        self.calls += 1
        return [[float(len(t)), 1.0, 0.0] for t in texts]

    def question(self, text):
        return [1.0, 0.0, 0.0]


class FakeSearcher:
    """Devuelve los candidatos que cumplen todas las condiciones (igualdad o pertenencia a lista)."""

    def __init__(self, candidates):
        self.candidates = candidates
        self.calls: list[dict] = []

    def search(self, vector, conditions, limit):
        self.calls.append(conditions)

        def matches_filter(c):
            for field_name, field_value in conditions.items():
                current = c.get(field_name)
                if isinstance(field_value, list):
                    current_items = current if isinstance(current, list) else [current]
                    if not set(field_value) & set(current_items):
                        return False
                elif current != field_value:
                    return False
            return True

        return [dict(c) for c in self.candidates if matches_filter(c)][:limit]


class FakeReranker:
    """Puntúa por palabras de la pregunta presentes en el texto, menos 1 (así sin coincidencias queda < 0)."""

    def score_pairs(self, question, texts):
        words = set(question.lower().split())
        return [float(len(words & set(t.lower().split())) - 1) for t in texts]
