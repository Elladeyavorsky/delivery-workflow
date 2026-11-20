from docs_rag.cleanup import to_markdown, is_reference, html_to_md, mdx_to_md, remove_repeated, rst_to_md


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
