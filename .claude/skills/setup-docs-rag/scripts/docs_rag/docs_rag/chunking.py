"""Troceo por estructura Markdown (receta del informe en docs/research/).

Se corta por encabezados # a #### fuera de bloques de código. Las secciones de menos de
`minimo` caracteres se unen con la siguiente del mismo fichero (la última, con la anterior)
y las de más de `maximo` se subdividen por líneas en blanco, sin cortar bloques de código
ni entradas de definición. El texto de cada fragmento es el original: los fragmentos de un
fichero, unidos en orden, reproducen el fichero.
"""

from __future__ import annotations

import re

MAX_CHARS = 1500
MIN_CHARS = 200

_HEADING = re.compile(r"^(#{1,4}) (.*)$")


def _is_fence(line: str) -> bool:
    return line.lstrip().startswith("```") or line.lstrip().startswith("~~~")


def sections(content: str) -> list[tuple[str, str]]:
    """Parte un fichero en (texto, ruta_titulos) por encabezados # a #### fuera de código."""
    result: list[tuple[str, str]] = []
    titles = ["", "", "", ""]
    in_code = False
    current: list[str] = []
    current_path = ""
    for line in content.splitlines(keepends=True):
        if in_code:
            current.append(line)
            if _is_fence(line):
                in_code = False
            continue
        if _is_fence(line):
            in_code = True
            current.append(line)
            continue
        m = _HEADING.match(line.rstrip("\r\n"))
        if m:
            if current:
                result.append(("".join(current), current_path))
            level = len(m.group(1))
            titles[level - 1] = m.group(2).replace("`", "").strip()
            for i in range(level, 4):
                titles[i] = ""
            current_path = " > ".join(t for t in titles if t)
            current = [line]
        else:
            current.append(line)
    if current:
        result.append(("".join(current), current_path))
    return result


def blocks(text: str) -> list[str]:
    """Separa por líneas en blanco sin cortar bloques de código ni entradas de definición."""
    lines = text.splitlines(keepends=True)
    result: list[str] = []
    current: list[str] = []
    has_text = False
    in_code = False
    in_definition = False
    after_blank = False
    for i, line in enumerate(lines):
        if in_code:
            current.append(line)
            if _is_fence(line):
                in_code = False
            continue
        blank = not line.strip()
        if in_definition:
            if blank:
                following = next((x for x in lines[i + 1 :] if x.strip()), None)
                if following is not None and following[0] in " \t":
                    current.append(line)
                    continue
                in_definition = False
            elif line[0] in " \t:":
                current.append(line)
                if _is_fence(line):
                    in_code = True
                continue
            else:
                in_definition = False
        if blank:
            current.append(line)
            after_blank = True
            continue
        if after_blank and has_text:
            result.append("".join(current))
            current = []
        after_blank = False
        has_text = True
        current.append(line)
        if _is_fence(line):
            in_code = True
        elif i + 1 < len(lines) and lines[i + 1].startswith(":"):
            in_definition = True
    if current:
        result.append("".join(current))
    return result


def split_long(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    pieces: list[str] = []
    current = ""
    for block in blocks(text):
        if current and len(current) + len(block) > max_chars:
            pieces.append(current)
            current = ""
        current += block
    if current:
        pieces.append(current)
    return pieces


def chunk_file(source: str, content: str, max_chars: int = MAX_CHARS, min_chars: int = MIN_CHARS) -> list[dict]:
    """Fragmentos de un fichero: {"source", "n", "text", "heading_path"}. n empieza en 0 por fichero."""
    if max_chars <= 0 or min_chars < 0 or min_chars >= max_chars:
        raise ValueError(f"maximo y minimo no válidos: {max_chars}/{min_chars}")
    merged: list[list[str]] = []
    pending: list[str] | None = None
    for text, titles in sections(content):
        if pending is None:
            pending = [text, titles]
        else:
            pending[0] += text
        if len(pending[0]) >= min_chars and pending[0].strip():
            merged.append(pending)
            pending = None
    if pending is not None:
        if merged:
            merged[-1][0] += pending[0]
        elif pending[0].strip():
            merged.append(pending)
    chunks: list[dict] = []
    for text, titles in merged:
        for piece in split_long(text, max_chars):
            chunks.append({"source": source, "n": len(chunks), "text": piece, "heading_path": titles})
    return chunks
