from docs_rag.limpieza import a_markdown, es_referencia, html_a_md, mdx_a_md, quitar_repetidas, rst_a_md


def test_html_a_md_quita_navegacion_y_marcas():
    html = """<html><body><div class="related">Navigation</div><nav>menu</nav>
    <div role="main"><h1>os — Misc<a class="headerlink" href="#">¶</a></h1><p>Texto <code>os.path</code>.</p>
    <div class="highlight-python"><pre>import os</pre></div></div><footer>pie</footer></body></html>"""
    md = html_a_md(html)
    assert md.startswith("# os — Misc")
    assert "¶" not in md and "Navigation" not in md and "menu" not in md and "pie" not in md
    assert "```python\nimport os\n```" in md


def test_rst_a_md_titulos_codigo_definiciones_y_versiones():
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
    md = rst_a_md(rst)
    assert "# Título" in md and "## Sección" in md
    assert "Added in version 2.1: Algo nuevo." in md
    assert "`get(url, **kwargs)`\n:   Sends a GET. See `requests.request`." in md
    assert "```python\nimport requests\n```" in md
    assert 'Ejemplo:\n\n```\nr = get("x")\n```' in md


def test_mdx_quita_frontmatter_e_imports():
    md = mdx_a_md("---\ntitle: X\n---\nimport A from 'a'\n\n# Hola\n\n<A />\n")
    assert md.startswith("# Hola") and "import" not in md


def test_quitar_repetidas_entre_paginas_pero_no_en_codigo():
    ficheros = {f"{i}.md": f"Edit this page on GitHub\n\n# Página {i}\n\n```\nEdit this page on GitHub\n```\n" for i in range(6)}
    limpio = quitar_repetidas(ficheros)
    for texto in limpio.values():
        assert texto.startswith("# Página")
        assert "```\nEdit this page on GitHub\n```" in texto


def test_es_referencia_y_a_markdown():
    assert es_referencia("library/os.html")
    assert not es_referencia("genindex.html")
    assert not es_referencia("docs/CHANGELOG.md")
    assert not es_referencia("blog/2024/post.md")
    assert a_markdown("docs/a.mdx", "# A\n")[0] == "docs/a.md"
    assert a_markdown("api.rst", "T\n=\n")[1].startswith("# T")
