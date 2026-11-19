"""Troceo por estructura Markdown (receta del informe en docs/research/).

Se corta por encabezados # a #### fuera de bloques de código. Las secciones de menos de
`minimo` caracteres se unen con la siguiente del mismo fichero (la última, con la anterior)
y las de más de `maximo` se subdividen por líneas en blanco, sin cortar bloques de código
ni entradas de definición. El texto de cada fragmento es el original: los fragmentos de un
fichero, unidos en orden, reproducen el fichero.
"""

from __future__ import annotations

import re

MAXIMO = 1500
MINIMO = 200

_ENCABEZADO = re.compile(r"^(#{1,4}) (.*)$")


def _es_valla(linea: str) -> bool:
    return linea.lstrip().startswith("```") or linea.lstrip().startswith("~~~")


def secciones(contenido: str) -> list[tuple[str, str]]:
    """Parte un fichero en (texto, ruta_titulos) por encabezados # a #### fuera de código."""
    resultado: list[tuple[str, str]] = []
    titulos = ["", "", "", ""]
    en_codigo = False
    actual: list[str] = []
    ruta_actual = ""
    for linea in contenido.splitlines(keepends=True):
        if en_codigo:
            actual.append(linea)
            if _es_valla(linea):
                en_codigo = False
            continue
        if _es_valla(linea):
            en_codigo = True
            actual.append(linea)
            continue
        m = _ENCABEZADO.match(linea.rstrip("\r\n"))
        if m:
            if actual:
                resultado.append(("".join(actual), ruta_actual))
            nivel = len(m.group(1))
            titulos[nivel - 1] = m.group(2).replace("`", "").strip()
            for i in range(nivel, 4):
                titulos[i] = ""
            ruta_actual = " > ".join(t for t in titulos if t)
            actual = [linea]
        else:
            actual.append(linea)
    if actual:
        resultado.append(("".join(actual), ruta_actual))
    return resultado


def bloques(texto: str) -> list[str]:
    """Separa por líneas en blanco sin cortar bloques de código ni entradas de definición."""
    lineas = texto.splitlines(keepends=True)
    resultado: list[str] = []
    actual: list[str] = []
    hay_texto = False
    en_codigo = False
    en_def = False
    tras_blanco = False
    for i, linea in enumerate(lineas):
        if en_codigo:
            actual.append(linea)
            if _es_valla(linea):
                en_codigo = False
            continue
        blanco = not linea.strip()
        if en_def:
            if blanco:
                siguiente = next((x for x in lineas[i + 1 :] if x.strip()), None)
                if siguiente is not None and siguiente[0] in " \t":
                    actual.append(linea)
                    continue
                en_def = False
            elif linea[0] in " \t:":
                actual.append(linea)
                if _es_valla(linea):
                    en_codigo = True
                continue
            else:
                en_def = False
        if blanco:
            actual.append(linea)
            tras_blanco = True
            continue
        if tras_blanco and hay_texto:
            resultado.append("".join(actual))
            actual = []
        tras_blanco = False
        hay_texto = True
        actual.append(linea)
        if _es_valla(linea):
            en_codigo = True
        elif i + 1 < len(lineas) and lineas[i + 1].startswith(":"):
            en_def = True
    if actual:
        resultado.append("".join(actual))
    return resultado


def subdividir(texto: str, maximo: int) -> list[str]:
    if len(texto) <= maximo:
        return [texto]
    trozos: list[str] = []
    actual = ""
    for bloque in bloques(texto):
        if actual and len(actual) + len(bloque) > maximo:
            trozos.append(actual)
            actual = ""
        actual += bloque
    if actual:
        trozos.append(actual)
    return trozos


def trocear(fuente: str, contenido: str, maximo: int = MAXIMO, minimo: int = MINIMO) -> list[dict]:
    """Fragmentos de un fichero: {"fuente", "n", "texto", "ruta_titulos"}. n empieza en 0 por fichero."""
    if maximo <= 0 or minimo < 0 or minimo >= maximo:
        raise ValueError(f"maximo y minimo no válidos: {maximo}/{minimo}")
    fusion: list[list[str]] = []
    pendiente: list[str] | None = None
    for texto, titulos in secciones(contenido):
        if pendiente is None:
            pendiente = [texto, titulos]
        else:
            pendiente[0] += texto
        if len(pendiente[0]) >= minimo and pendiente[0].strip():
            fusion.append(pendiente)
            pendiente = None
    if pendiente is not None:
        if fusion:
            fusion[-1][0] += pendiente[0]
        elif pendiente[0].strip():
            fusion.append(pendiente)
    fragmentos: list[dict] = []
    for texto, titulos in fusion:
        for trozo in subdividir(texto, maximo):
            fragmentos.append({"fuente": fuente, "n": len(fragmentos), "texto": trozo, "ruta_titulos": titulos})
    return fragmentos
