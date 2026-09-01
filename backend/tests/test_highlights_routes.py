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


def _import_book(client, auth_headers, tmp_path, n_paragraphs=10):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "book.txt"
    source.write_text(
        "\n\n".join(f"Paragraph number {i} has several words in it." for i in range(n_paragraphs)),
        encoding="utf-8",
    )
    book_id = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    ).json()[0]["id"]
    return user_id, book_id


def test_highlights_require_token(client, tmp_path):
    res = client.post("/books/x/highlights", json={"user_id": "u", "block_index": 0, "start_char": 0, "end_char": 1, "colour": "yellow", "quoted_text": "a"})
    assert res.status_code == 401


def test_create_and_list_highlight(client, auth_headers, tmp_path):
    user_id, book_id = _import_book(client, auth_headers, tmp_path)

    res = client.post(
        f"/books/{book_id}/highlights",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "block_index": 0,
            "start_char": 10,
            "end_char": 16,
            "colour": "yellow",
            "quoted_text": "number",
            "note": "first note",
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["colour"] == "yellow"
    assert body["quoted_text"] == "number"
    assert body["note"] == "first note"
    assert body["page"] == 1

    listed = client.get(f"/books/{book_id}/highlights", headers=auth_headers, params={"user_id": user_id}).json()
    assert len(listed) == 1
    assert listed[0]["id"] == body["id"]


def test_highlight_end_before_start_rejected(client, auth_headers, tmp_path):
    user_id, book_id = _import_book(client, auth_headers, tmp_path)
    res = client.post(
        f"/books/{book_id}/highlights",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": 0, "start_char": 10, "end_char": 5, "colour": "yellow", "quoted_text": "x"},
    )
    assert res.status_code == 400


def test_highlight_block_index_out_of_range_rejected(client, auth_headers, tmp_path):
    user_id, book_id = _import_book(client, auth_headers, tmp_path, n_paragraphs=3)
    res = client.post(
        f"/books/{book_id}/highlights",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": 999, "start_char": 0, "end_char": 5, "colour": "yellow", "quoted_text": "x"},
    )
    assert res.status_code == 400


def test_update_highlight_colour_and_note(client, auth_headers, tmp_path):
    user_id, book_id = _import_book(client, auth_headers, tmp_path)
    hid = client.post(
        f"/books/{book_id}/highlights",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": 0, "start_char": 0, "end_char": 9, "colour": "yellow", "quoted_text": "Paragraph"},
    ).json()["id"]

    res = client.patch(
        f"/books/{book_id}/highlights/{hid}", headers=auth_headers, json={"colour": "green", "note": "updated"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["colour"] == "green"
    assert body["note"] == "updated"


def test_delete_highlight(client, auth_headers, tmp_path):
    user_id, book_id = _import_book(client, auth_headers, tmp_path)
    hid = client.post(
        f"/books/{book_id}/highlights",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": 0, "start_char": 0, "end_char": 9, "colour": "pink", "quoted_text": "Paragraph"},
    ).json()["id"]

    res = client.delete(f"/books/{book_id}/highlights/{hid}", headers=auth_headers)
    assert res.status_code == 204

    listed = client.get(f"/books/{book_id}/highlights", headers=auth_headers, params={"user_id": user_id}).json()
    assert listed == []


def test_highlight_survives_across_requests_with_note_intact(client, auth_headers, tmp_path):
    """Simulates close-then-reopen: create, then a fresh list call sees the
    exact same tint (colour) and note (spec Phase 3 'Done when')."""
    user_id, book_id = _import_book(client, auth_headers, tmp_path)
    client.post(
        f"/books/{book_id}/highlights",
        headers=auth_headers,
        json={
            "user_id": user_id, "block_index": 2, "start_char": 3, "end_char": 12,
            "colour": "blue", "quoted_text": "graph numb", "note": "remember this",
        },
    )

    reopened = client.get(f"/books/{book_id}/highlights", headers=auth_headers, params={"user_id": user_id}).json()
    assert len(reopened) == 1
    assert reopened[0]["colour"] == "blue"
    assert reopened[0]["note"] == "remember this"
    assert reopened[0]["quoted_text"] == "graph numb"


def test_create_and_list_bookmark_with_page(client, auth_headers, tmp_path):
    user_id, book_id = _import_book(client, auth_headers, tmp_path, n_paragraphs=120)
    res = client.post(
        f"/books/{book_id}/bookmarks",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": 40, "label": "interesting bit"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["label"] == "interesting bit"
    assert body["page"] >= 1

    listed = client.get(f"/books/{book_id}/bookmarks", headers=auth_headers, params={"user_id": user_id}).json()
    assert len(listed) == 1
    assert listed[0]["block_index"] == 40


def test_delete_bookmark(client, auth_headers, tmp_path):
    user_id, book_id = _import_book(client, auth_headers, tmp_path)
    bid = client.post(
        f"/books/{book_id}/bookmarks", headers=auth_headers, json={"user_id": user_id, "block_index": 0, "label": "start"}
    ).json()["id"]

    res = client.delete(f"/books/{book_id}/bookmarks/{bid}", headers=auth_headers)
    assert res.status_code == 204

    listed = client.get(f"/books/{book_id}/bookmarks", headers=auth_headers, params={"user_id": user_id}).json()
    assert listed == []


def test_bookmark_block_index_out_of_range_rejected(client, auth_headers, tmp_path):
    user_id, book_id = _import_book(client, auth_headers, tmp_path, n_paragraphs=3)
    res = client.post(
        f"/books/{book_id}/bookmarks", headers=auth_headers, json={"user_id": user_id, "block_index": 999, "label": "x"}
    )
    assert res.status_code == 400
