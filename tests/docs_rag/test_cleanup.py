from docs_rag.cleanup import to_markdown, is_reference, html_to_md, mdx_to_md, remove_repeated, rst_to_md
from docs_rag.profiles import chunk_metadata


def test_html_to_md_strips_navigation_and_markup():
    html = """<html><body><div class="related">Navigation</div><nav>menu</nav>
    <div role="main"><h1>os — Misc<a class="headerlink" href="#">¶</a></h1><p>Texto <code>os.path</code>.</p>
    <div class="highlight-python"><pre>import os</pre></div></div><footer>pie</footer></body></html>"""
    md = html_to_md(html)
    assert md.startswith("# os — Misc")
    assert "¶" not in md and "Navigation" not in md and "menu" not in md and "pie" not in md
    assert "```python\nimport os\n```" in md


def test_rst_to_md_titles_code_definitions_and_versions():
    rst = """Título
======

Sección
-------

.. versionadded:: 2.1
   Algo nuevo.

.. function:: get(url, **kwargs)

   Sends a GET. See :func:`requests.request`.

.. code-block:: python

   import requests

Ejemplo::

    r = get("x")
"""
    md = rst_to_md(rst)
    assert "# Título" in md and "## Sección" in md
    assert "Added in version 2.1: Algo nuevo." in md
    assert "`get(url, **kwargs)`\n:   Sends a GET. See `requests.request`." in md
    assert "```python\nimport requests\n```" in md
    assert 'Ejemplo:\n\n```\nr = get("x")\n```' in md


def test_rst_versionadded_inside_note_keeps_quote_and_version_line():
    md = rst_to_md(".. note::\n\n   Usa esto con cuidado.\n\n   .. versionadded:: 3.4\n\n      Nuevo parámetro.\n")
    assert "> **Note:** Usa esto con cuidado." in md
    assert "> Added in version 3.4: Nuevo parámetro." in md
    assert chunk_metadata("sphinx", md)["added_in"] == ["3.4"]


def test_rst_tables_do_not_become_headings_and_keep_cell_order():
    grid = "+-----+-----+\n| Uno | Dos |\n+=====+=====+\n| Tres| Cua |\n+-----+-----+\n"
    simple = "=====  =====\nUno    Dos\n=====  =====\nTres   Cua\n=====  =====\n"
    for rst in (grid, simple):
        md = rst_to_md(rst)
        assert "#" not in md
        assert [md.index(c) for c in ("Uno", "Dos", "Tres", "Cua")] == sorted(md.index(c) for c in ("Uno", "Dos", "Tres", "Cua"))


def test_rst_substitution_is_resolved():
    md = rst_to_md(".. |nombre| replace:: la librería X\n\nUsa |nombre| hoy.\n")
    assert "Usa la librería X hoy." in md and "|nombre|" not in md


def test_rst_literalinclude_leaves_no_fence_or_path():
    md = rst_to_md("Antes.\n\n.. literalinclude:: ../ejemplos/uno.py\n   :language: python\n\nDespués.\n")
    assert "uno.py" not in md and "```" not in md
    assert "Antes." in md and "Después." in md


def test_rst_roles_modules_and_docutils_warnings():
    md = rst_to_md(".. module:: asyncio\n\nVer :py:class:`~asyncio.Task` y :ref:`ver más <otro>`.\n\n.. directiva-rara::\n\n   Cuerpo que se conserva.\n")
    assert "Module: `asyncio`" in md
    assert "`asyncio.Task`" in md and "`ver más`" in md
    assert "Cuerpo que se conserva." in md
    assert "Unknown directive" not in md and "System Message" not in md


def test_rst_nested_definitions_and_other_version_lines():
    md = rst_to_md(".. class:: Session\n\n   Una sesión.\n\n   .. method:: close()\n\n      Cierra.\n\n      .. versionchanged:: 2.0\n         Ya no falla.\n\n.. deprecated:: 3.1 Usa otra.\n")
    assert "`Session`\n:   Una sesión." in md
    assert "    `close()`\n    :   Cierra." in md
    assert "Changed in version 2.0: Ya no falla." in md
    assert "Deprecated since version 3.1: Usa otra." in md


def test_rst_that_docutils_cannot_use_keeps_the_source_text():
    md = rst_to_md(".. toctree::\n   :maxdepth: 2\n\n   intro\n")
    assert "intro" in md


def test_mdx_strips_frontmatter_and_imports():
    md = mdx_to_md("---\ntitle: X\n---\nimport A from 'a'\n\n# Hola\n\n<A />\n")
    assert md.startswith("# Hola") and "import" not in md


def test_remove_repeated_lines_across_pages_but_not_in_code():
    files = {f"{i}.md": f"Edit this page on GitHub\n\n# Página {i}\n\n```\nEdit this page on GitHub\n```\n" for i in range(6)}
    cleaned = remove_repeated(files)
    for text in cleaned.values():
        assert text.startswith("# Página")
        assert "```\nEdit this page on GitHub\n```" in text


def test_is_reference_and_to_markdown():
    assert is_reference("library/os.html")
    assert not is_reference("genindex.html")
    assert not is_reference("docs/CHANGELOG.md")
    assert not is_reference("blog/2024/post.md")
    assert to_markdown("docs/a.mdx", "# A\n")[0] == "docs/a.md"
    assert to_markdown("api.rst", "T\n=\n")[1].startswith("# T")
    assert to_markdown("api.rst", "T\n=\n")[0] == "api.md"
