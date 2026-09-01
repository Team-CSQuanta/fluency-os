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
