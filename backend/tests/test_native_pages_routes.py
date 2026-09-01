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
