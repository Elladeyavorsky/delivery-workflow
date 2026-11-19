from docs_rag.troceo import secciones, trocear


def test_los_fragmentos_reproducen_el_fichero():
    texto = "# A\n\n" + "uno " * 100 + "\n\n## B\n\nbreve\n\n## C\n\n" + "dos " * 600 + "\n"
    frags = trocear("x.md", texto)
    assert "".join(f["texto"] for f in frags) == texto
    assert [f["n"] for f in frags] == list(range(len(frags)))


def test_une_secciones_cortas_y_parte_las_largas_sin_cortar_codigo():
    codigo = "```python\n" + "x = 1\n\n" * 300 + "```\n"
    texto = "# T\n\ncorta\n\n## Larga\n\n" + ("parrafo " * 30 + "\n\n") * 20 + codigo
    frags = trocear("x.md", texto, maximo=1500, minimo=200)
    assert all(f["texto"].count("```") % 2 == 0 for f in frags), "un bloque de código no se corta"
    assert frags[0]["texto"].startswith("# T") and "## Larga" in frags[0]["texto"], "la sección corta se une con la siguiente"
    assert len(frags) > 2


def test_ruta_de_titulos_y_encabezados_dentro_de_codigo():
    texto = "# Uno\n\n## Dos\n\n```\n# no es título\n```\n"
    s = secciones(texto)
    assert [r for _, r in s] == ["Uno", "Uno > Dos"]


def test_valores_no_validos():
    import pytest

    with pytest.raises(ValueError):
        trocear("x.md", "a", maximo=100, minimo=200)
