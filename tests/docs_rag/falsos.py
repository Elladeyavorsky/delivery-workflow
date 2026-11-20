"""Dobles de prueba: red, Qdrant, embeddings y reordenador, sin servicios ni modelos."""

import io
import json
import urllib.error
import zipfile


class HttpFalso:
    """Responde según un diccionario url → bytes|str|dict; el resto da 404. Guarda las URLs pedidas."""

    def __init__(self, respuestas: dict):
        self.respuestas = respuestas
        self.pedidas: list[str] = []

    def __call__(self, url, cabeceras=None, timeout=120):
        self.pedidas.append(url)
        if url not in self.respuestas:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        r = self.respuestas[url]
        if isinstance(r, Exception):
            raise r
        if isinstance(r, (dict, list)):
            return json.dumps(r).encode()
        return r.encode() if isinstance(r, str) else r


def zip_de(ficheros: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nombre, texto in ficheros.items():
            z.writestr(nombre, texto)
    return buf.getvalue()


class IndiceFalso:
    def __init__(self):
        self.puntos: dict[str, dict] = {}
        self.dimension = None
        self.borrados: list[tuple[str, str]] = []

    def asegurar(self, dimension):
        self.dimension = dimension

    def existe(self):
        return self.dimension is not None

    def borrar_paquete(self, ecosistema, paquete):
        self.borrados.append((ecosistema, paquete))
        self.puntos = {i: p for i, p in self.puntos.items() if not (p["payload"]["ecosystem"] == ecosistema and p["payload"]["package"] == paquete)}

    def subir(self, puntos):
        for p in puntos:
            self.puntos[p["id"]] = p

    def contar(self, ecosistema=None, paquete=None):
        return sum(1 for p in self.puntos.values() if (not ecosistema or p["payload"]["ecosystem"] == ecosistema) and (not paquete or p["payload"]["package"] == paquete))

    def borrar_coleccion(self):
        existia = self.existe()
        self.puntos, self.dimension = {}, None
        return existia


class EmbebedorFalso:
    def __init__(self):
        self.llamadas = 0

    def documentos(self, textos):
        self.llamadas += 1
        return [[float(len(t)), 1.0, 0.0] for t in textos]

    def pregunta(self, texto):
        return [1.0, 0.0, 0.0]


class BuscadorFalso:
    """Devuelve los candidatos que cumplen todas las condiciones (igualdad o pertenencia a lista)."""

    def __init__(self, candidatos):
        self.candidatos = candidatos
        self.llamadas: list[dict] = []

    def buscar(self, vector, condiciones, limite):
        self.llamadas.append(condiciones)

        def cumple(c):
            for campo, valor in condiciones.items():
                actual = c.get(campo)
                if isinstance(valor, list):
                    actuales = actual if isinstance(actual, list) else [actual]
                    if not set(valor) & set(actuales):
                        return False
                elif actual != valor:
                    return False
            return True

        return [dict(c) for c in self.candidatos if cumple(c)][:limite]


class ReordenadorFalso:
    """Puntúa por palabras de la pregunta presentes en el texto, menos 1 (así sin coincidencias queda < 0)."""

    def puntuar(self, pregunta, textos):
        palabras = set(pregunta.lower().split())
        return [float(len(palabras & set(t.lower().split())) - 1) for t in textos]
