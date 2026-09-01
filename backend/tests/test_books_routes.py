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


def test_import_requires_token(client):
    res = client.post("/books/import", json={"user_id": "u1", "paths": []})
    assert res.status_code == 401


def test_import_and_list_txt_book(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Plain Book.txt"
    source.write_text("First paragraph.\n\nSecond paragraph.", encoding="utf-8")

    res = client.post(
        "/books/import",
        headers=auth_headers,
        json={"user_id": user_id, "paths": [str(source)]},
    )
    assert res.status_code == 202
    imported = res.json()
    assert len(imported) == 1
    book_id = imported[0]["id"]

    # TestClient runs BackgroundTasks synchronously, so ingest has already finished.
    got = client.get(f"/books/{book_id}", headers=auth_headers)
    assert got.status_code == 200
    body = got.json()
    assert body["ingest_status"] == "ready"
    assert body["title"] == "Plain Book"
    assert body["total_blocks"] == 2

    listed = client.get("/books", headers=auth_headers, params={"user_id": user_id})
    assert listed.status_code == 200
    assert len(listed.json()) == 1


def test_import_missing_file_fails_gracefully(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    missing = tmp_path / "does_not_exist.txt"

    res = client.post(
        "/books/import",
        headers=auth_headers,
        json={"user_id": user_id, "paths": [str(missing)]},
    )
    assert res.status_code == 202
    body = res.json()[0]
    assert body["ingest_status"] == "failed"
    assert body["ingest_error"]


def test_reimport_same_file_returns_existing_book(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "dup.txt"
    source.write_text("Same content every time.", encoding="utf-8")

    first = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    ).json()
    second = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    ).json()

    assert first[0]["id"] == second[0]["id"]
    listed = client.get("/books", headers=auth_headers, params={"user_id": user_id}).json()
    assert len(listed) == 1


def test_counts_endpoint(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "counted.txt"
    source.write_text("Some content here.", encoding="utf-8")
    client.post("/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]})

    res = client.get("/books/counts", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    body = res.json()
    assert body["all"] == 1
    assert body["not_started"] == 1
    assert body["finished"] == 0


def test_patch_and_delete_book(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "patchable.txt"
    source.write_text("Content to patch.", encoding="utf-8")
    book_id = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    ).json()[0]["id"]

    patched = client.patch(
        f"/books/{book_id}", headers=auth_headers, json={"count_toward_goal": False}
    )
    assert patched.status_code == 200
    assert patched.json()["count_toward_goal"] is False

    deleted = client.delete(f"/books/{book_id}", headers=auth_headers)
    assert deleted.status_code == 204

    missing = client.get(f"/books/{book_id}", headers=auth_headers)
    assert missing.status_code == 404


def test_retry_ingest_requires_failed_status(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "already_ready.txt"
    source.write_text("Content that parses fine.", encoding="utf-8")
    book_id = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    ).json()[0]["id"]

    res = client.post(f"/books/{book_id}/retry-ingest", headers=auth_headers)
    assert res.status_code == 400


def test_epub_import(client, auth_headers, tmp_path):
    from ebooklib import epub

    book = epub.EpubBook()
    book.set_identifier("epub-route-test")
    book.set_title("Routed Book")
    book.set_language("en")
    book.add_author("Router Author")
    chapter = epub.EpubHtml(title="Ch1", file_name="chap1.xhtml", lang="en")
    chapter.content = "<h1>Ch1</h1><p>Some epub paragraph text.</p>"
    book.add_item(chapter)
    book.toc = (chapter,)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", chapter]
    epub_path = tmp_path / "routed.epub"
    epub.write_epub(str(epub_path), book, {"epub3_pages": False})

    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(epub_path)]}
    )
    book_id = res.json()[0]["id"]

    got = client.get(f"/books/{book_id}", headers=auth_headers).json()
    assert got["ingest_status"] == "ready"
    assert got["title"] == "Routed Book"
    assert got["author"] == "Router Author"


def _import_multi_paragraph_book(client, auth_headers, tmp_path, n_paragraphs=10):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "long_book.txt"
    source.write_text("\n\n".join(f"Paragraph number {i} has several words in it." for i in range(n_paragraphs)), encoding="utf-8")
    res = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    )
    book_id = res.json()[0]["id"]
    return user_id, book_id


def test_toc_for_txt_book_is_empty(client, auth_headers, tmp_path):
    _user_id, book_id = _import_multi_paragraph_book(client, auth_headers, tmp_path)
    res = client.get(f"/books/{book_id}/toc", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == []  # TXT has no chapter headings


def test_blocks_windowing(client, auth_headers, tmp_path):
    _user_id, book_id = _import_multi_paragraph_book(client, auth_headers, tmp_path, n_paragraphs=10)

    first_window = client.get(
        f"/books/{book_id}/blocks", headers=auth_headers, params={"from_index": 0, "limit": 4}
    ).json()
    assert len(first_window) == 4
    assert [b["block_index"] for b in first_window] == [0, 1, 2, 3]

    second_window = client.get(
        f"/books/{book_id}/blocks", headers=auth_headers, params={"from_index": 4, "limit": 4}
    ).json()
    assert [b["block_index"] for b in second_window] == [4, 5, 6, 7]

    past_end = client.get(
        f"/books/{book_id}/blocks", headers=auth_headers, params={"from_index": 100, "limit": 10}
    ).json()
    assert past_end == []


def test_position_defaults_to_zero_before_first_write(client, auth_headers, tmp_path):
    user_id, book_id = _import_multi_paragraph_book(client, auth_headers, tmp_path)
    res = client.get(f"/books/{book_id}/position", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    body = res.json()
    assert body["block_index"] == 0
    assert body["max_block_seen"] == 0
    assert body["page"] == 1
    assert body["percent"] == 10.0  # 1 of 10 blocks


def test_position_upsert_is_idempotent_and_readable(client, auth_headers, tmp_path):
    user_id, book_id = _import_multi_paragraph_book(client, auth_headers, tmp_path)

    for _ in range(2):
        res = client.put(
            f"/books/{book_id}/position",
            headers=auth_headers,
            json={"user_id": user_id, "block_index": 3, "char_offset": 12},
        )
        assert res.status_code == 204

    got = client.get(f"/books/{book_id}/position", headers=auth_headers, params={"user_id": user_id}).json()
    assert got["block_index"] == 3
    assert got["char_offset"] == 12
    assert got["max_block_seen"] == 3


def test_max_block_seen_never_decreases(client, auth_headers, tmp_path):
    user_id, book_id = _import_multi_paragraph_book(client, auth_headers, tmp_path)

    client.put(
        f"/books/{book_id}/position",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": 8, "char_offset": 0},
    )
    # Flip back to re-read an earlier paragraph.
    client.put(
        f"/books/{book_id}/position",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": 1, "char_offset": 0},
    )

    got = client.get(f"/books/{book_id}/position", headers=auth_headers, params={"user_id": user_id}).json()
    assert got["block_index"] == 1  # current position moved back
    assert got["max_block_seen"] == 8  # but furthest-read never decreases
    assert got["percent"] == 90.0  # derived from max_block_seen, not block_index


def test_position_out_of_range_rejected(client, auth_headers, tmp_path):
    user_id, book_id = _import_multi_paragraph_book(client, auth_headers, tmp_path, n_paragraphs=3)

    res = client.put(
        f"/books/{book_id}/position",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": 999, "char_offset": 0},
    )
    assert res.status_code == 400

    res_negative = client.put(
        f"/books/{book_id}/position",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": -1, "char_offset": 0},
    )
    assert res_negative.status_code == 400


def test_counts_reading_bucket_after_position_write(client, auth_headers, tmp_path):
    user_id, book_id = _import_multi_paragraph_book(client, auth_headers, tmp_path)

    before = client.get("/books/counts", headers=auth_headers, params={"user_id": user_id}).json()
    assert before["not_started"] == 1
    assert before["reading"] == 0

    client.put(
        f"/books/{book_id}/position",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": 2, "char_offset": 0},
    )

    after = client.get("/books/counts", headers=auth_headers, params={"user_id": user_id}).json()
    assert after["reading"] == 1
    assert after["not_started"] == 0


def test_epub_toc_has_chapters_with_pages(client, auth_headers, tmp_path):
    from ebooklib import epub

    book = epub.EpubBook()
    book.set_identifier("epub-toc-test")
    book.set_title("TOC Book")
    book.set_language("en")
    c1 = epub.EpubHtml(title="Ch1", file_name="c1.xhtml", lang="en")
    c1.content = "<h1>Chapter One</h1><p>" + " ".join(["word"] * 300) + "</p>"
    c2 = epub.EpubHtml(title="Ch2", file_name="c2.xhtml", lang="en")
    c2.content = "<h1>Chapter Two</h1><p>Short paragraph.</p>"
    book.add_item(c1)
    book.add_item(c2)
    book.toc = (c1, c2)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", c1, c2]
    path = tmp_path / "toc.epub"
    epub.write_epub(str(path), book, {"epub3_pages": False})

    user_id = _create_user(client, auth_headers)
    book_id = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(path)]}
    ).json()[0]["id"]

    toc = client.get(f"/books/{book_id}/toc", headers=auth_headers).json()
    labels = [c["label"] for c in toc]
    assert "Chapter One" in labels
    assert "Chapter Two" in labels
    ch2 = next(c for c in toc if c["label"] == "Chapter Two")
    assert ch2["page"] >= 2  # after ~300 words at 275/page


def _import_paginated_book(client, auth_headers, tmp_path, n_paragraphs=120):
    # 8 words/paragraph * 120 = 960 words -> ceil(960/275) = 4 pages.
    return _import_multi_paragraph_book(client, auth_headers, tmp_path, n_paragraphs=n_paragraphs)


def test_page_defaults_to_one(client, auth_headers, tmp_path):
    _user_id, book_id = _import_paginated_book(client, auth_headers, tmp_path)
    res = client.get(f"/books/{book_id}/page", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["page"] == 1
    assert body["has_prev"] is False
    assert body["total_pages"] == 4
    assert len(body["blocks"]) > 0


def test_pages_partition_all_blocks_without_overlap(client, auth_headers, tmp_path):
    _user_id, book_id = _import_paginated_book(client, auth_headers, tmp_path)
    total_pages = client.get(f"/books/{book_id}/page", headers=auth_headers).json()["total_pages"]
    assert total_pages == 4

    seen_indices = []
    for page_num in range(1, total_pages + 1):
        body = client.get(f"/books/{book_id}/page", headers=auth_headers, params={"page": page_num}).json()
        assert body["page"] == page_num
        assert body["has_prev"] == (page_num > 1)
        assert body["has_next"] == (page_num < total_pages)
        assert len(body["blocks"]) > 0
        seen_indices.extend(b["block_index"] for b in body["blocks"])

    # Every block appears on exactly one page, in order, with none skipped.
    assert seen_indices == sorted(set(seen_indices))
    assert seen_indices == list(range(len(seen_indices)))


def test_page_out_of_range_clamps(client, auth_headers, tmp_path):
    _user_id, book_id = _import_paginated_book(client, auth_headers, tmp_path)

    too_high = client.get(f"/books/{book_id}/page", headers=auth_headers, params={"page": 999}).json()
    assert too_high["page"] == 4
    assert too_high["has_next"] is False

    too_low = client.get(f"/books/{book_id}/page", headers=auth_headers, params={"page": 0}).json()
    assert too_low["page"] == 1
