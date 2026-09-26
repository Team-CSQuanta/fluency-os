"""End-to-end: a PDF pages by its own printed boundaries (spec Phase 5).

The reader's page numbers have to agree with the numbers printed in the
document, so these tests go through the real routes rather than the parser —
what matters is that /page, /toc and /position all agree on the same
numbering, not just that the parser recorded one.
"""

import fitz


def _create_user(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={
            "display_name": "Reader",
            "native_language": "en",
            "target_language": "en",
            "data_folder": "~/FluencyOS",
        },
    )
    assert res.status_code == 201
    return res.json()["id"]


def _write_pdf(path, page_bodies):
    doc = fitz.open()
    for body in page_bodies:
        page = doc.new_page()
        page.insert_text((72, 200), body, fontsize=11)
    doc.save(str(path))
    doc.close()


def _import(client, auth_headers, user_id, source):
    res = client.post(
        "/books/import",
        headers=auth_headers,
        json={"user_id": user_id, "paths": [str(source)]},
    )
    assert res.status_code == 202
    return res.json()[0]["id"]


def test_pdf_pages_follow_the_documents_own_boundaries(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Short Report.pdf"
    # Three short pages. Under word-count pagination all three would collapse
    # onto page 1, so this only passes if native pagination is in effect.
    _write_pdf(source, ["Alpha content here.", "Beta content here.", "Gamma content here."])

    book_id = _import(client, auth_headers, user_id, source)

    book = client.get(f"/books/{book_id}", headers=auth_headers).json()
    assert book["ingest_status"] == "ready", book.get("ingest_error")
    assert book["format"] == "pdf"
    assert book["page_estimate"] == 3

    page1 = client.get(f"/books/{book_id}/page", headers=auth_headers, params={"page": 1}).json()
    assert page1["total_pages"] == 3
    assert page1["has_prev"] is False
    assert page1["has_next"] is True
    assert "Alpha" in " ".join(b["text"] for b in page1["blocks"])

    page3 = client.get(f"/books/{book_id}/page", headers=auth_headers, params={"page": 3}).json()
    assert page3["has_next"] is False
    assert "Gamma" in " ".join(b["text"] for b in page3["blocks"])


def test_position_reports_the_native_page(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Paged.pdf"
    _write_pdf(source, ["One.", "Two.", "Three."])
    book_id = _import(client, auth_headers, user_id, source)

    page3 = client.get(f"/books/{book_id}/page", headers=auth_headers, params={"page": 3}).json()
    third_block = page3["first_block_index"]

    put = client.put(
        f"/books/{book_id}/position",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": third_block, "char_offset": 0},
    )
    assert put.status_code == 204

    position = client.get(
        f"/books/{book_id}/position", headers=auth_headers, params={"user_id": user_id}
    ).json()
    assert position["page"] == 3
    assert position["total_pages"] == 3


def test_txt_book_still_uses_word_count_pagination(client, auth_headers, tmp_path):
    """The native-page branch must not leak into reflowable formats — a short
    TXT file is still one page, however many paragraphs it has."""
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Reflowable.txt"
    source.write_text("First para.\n\nSecond para.\n\nThird para.", encoding="utf-8")
    book_id = _import(client, auth_headers, user_id, source)

    page1 = client.get(f"/books/{book_id}/page", headers=auth_headers, params={"page": 1}).json()

    assert page1["total_pages"] == 1
    assert len(page1["blocks"]) == 3


def test_original_page_renders_as_an_image(client, auth_headers, tmp_path):
    """The text pipeline drops everything that is not prose, so the rendered
    page is the only way to see a figure, a plate or a table as it was set."""
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Illustrated.pdf"
    _write_pdf(source, ["Alpha content here.", "Beta content here."])
    book_id = _import(client, auth_headers, user_id, source)

    assert client.get(f"/books/{book_id}", headers=auth_headers).json()["has_page_images"] is True

    res = client.get(f"/books/{book_id}/page/2/image", headers=auth_headers)

    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert res.content[:4] == b"\x89PNG"


def test_page_image_is_cached_after_the_first_render(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Cached.pdf"
    _write_pdf(source, ["Only page here."])
    book_id = _import(client, auth_headers, user_id, source)

    first = client.get(f"/books/{book_id}/page/1/image", headers=auth_headers)
    second = client.get(f"/books/{book_id}/page/1/image", headers=auth_headers)

    assert first.status_code == second.status_code == 200
    assert first.content == second.content


def test_page_image_rejects_a_page_that_does_not_exist(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Two.pdf"
    _write_pdf(source, ["One.", "Two."])
    book_id = _import(client, auth_headers, user_id, source)

    assert client.get(f"/books/{book_id}/page/9/image", headers=auth_headers).status_code == 404
    assert client.get(f"/books/{book_id}/page/0/image", headers=auth_headers).status_code == 404


def test_reflowable_books_have_no_original_page(client, auth_headers, tmp_path):
    """A .txt never had a page, so asking for one is a 404 rather than a
    rendered approximation of where the text happened to land."""
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Plain.txt"
    source.write_text("Some plain text content for the book.\n\nA second paragraph.\n")
    book_id = _import(client, auth_headers, user_id, source)

    assert client.get(f"/books/{book_id}", headers=auth_headers).json()["has_page_images"] is False
    assert client.get(f"/books/{book_id}/page/1/image", headers=auth_headers).status_code == 404


def test_a_page_with_no_text_is_still_a_page(client, auth_headers, tmp_path):
    """A plate, a full-page figure or a blank leaf yields no blocks at all.

    Counting pages from the blocks — which is what this did — ends the book at
    its last page of prose, so anything after it cannot be reached and the
    original page can never be shown for it.
    """
    import pymupdf

    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Plated.pdf"
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 200), "The only page with words on it.", fontsize=11)
    picture = doc.new_page()
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 200))
    pix.set_rect(pix.irect, (120, 160, 90))
    picture.insert_image(pymupdf.Rect(100, 150, 400, 450), pixmap=pix)
    doc.save(str(source))
    doc.close()

    book_id = _import(client, auth_headers, user_id, source)
    book = client.get(f"/books/{book_id}", headers=auth_headers).json()

    assert book["ingest_status"] == "ready", book.get("ingest_error")
    assert book["page_estimate"] == 2

    page2 = client.get(f"/books/{book_id}/page", headers=auth_headers, params={"page": 2}).json()
    assert page2["page"] == 2
    assert page2["total_pages"] == 2
    assert page2["blocks"] == []
    assert page2["has_next"] is False
    # And the page itself is still there to look at, which is the whole point.
    assert client.get(f"/books/{book_id}/page/2/image", headers=auth_headers).status_code == 200
