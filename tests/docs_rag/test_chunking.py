from docs_rag.chunking import sections, chunk_file


def test_chunks_rebuild_the_file():
    text = "# A\n\n" + "uno " * 100 + "\n\n## B\n\nbreve\n\n## C\n\n" + "dos " * 600 + "\n"
    file_chunks = chunk_file("x.md", text)
    assert "".join(f["text"] for f in file_chunks) == text
    assert [f["n"] for f in file_chunks] == list(range(len(file_chunks)))


def test_merges_short_sections_and_splits_long_ones_without_cutting_code():
    code_text = "```python\n" + "x = 1\n\n" * 300 + "```\n"
    text = "# T\n\ncorta\n\n## Larga\n\n" + ("parrafo " * 30 + "\n\n") * 20 + code_text
    file_chunks = chunk_file("x.md", text, max_chars=1500, min_chars=200)
    assert all(f["text"].count("```") % 2 == 0 for f in file_chunks), "un bloque de código no se corta"
    assert file_chunks[0]["text"].startswith("# T") and "## Larga" in file_chunks[0]["text"], "la sección corta se une con la siguiente"
    assert len(file_chunks) > 2


def test_heading_path_and_headings_inside_code():
    text = "# Uno\n\n## Dos\n\n```\n# no es título\n```\n"
    s = sections(text)
    assert [r for _, r in s] == ["Uno", "Uno > Dos"]


def test_invalid_values():
    import pytest

    with pytest.raises(ValueError):
        chunk_file("x.md", "a", max_chars=100, min_chars=200)
