"""Marking a book finished (PATCH /books/{id} with `finished`).

finished_at was read by the Finished chip, both other filter chips, the tile
progress bar and "continue reading" — but nothing could ever write it, so the
Finished count was structurally stuck at 0 and no book could leave Reading.
"""

SAMPLE = "\n\n".join(f"Paragraph {i}. " + " ".join(["word"] * 60) for i in range(6))


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


def _import(client, auth_headers, tmp_path, user_id, name="Finish Sample"):
    source = tmp_path / f"{name}.txt"
    source.write_text(SAMPLE, encoding="utf-8")
    res = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    )
    assert res.status_code == 202
    return res.json()[0]["id"]


def _counts(client, auth_headers, user_id):
    return client.get("/books/counts", headers=auth_headers, params={"user_id": user_id}).json()


def _set_finished(client, auth_headers, book_id, finished):
    res = client.patch(f"/books/{book_id}", headers=auth_headers, json={"finished": finished})
    assert res.status_code == 200
    return res.json()


def test_marking_finished_sets_a_timestamp(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)

    assert client.get(f"/books/{book_id}", headers=auth_headers).json()["finished_at"] is None
    assert _set_finished(client, auth_headers, book_id, True)["finished_at"] is not None


def test_finished_moves_the_counts(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)

    assert _counts(client, auth_headers, user_id) == {
        "all": 1,
        "reading": 0,
        "not_started": 1,
        "finished": 0,
    }

    _set_finished(client, auth_headers, book_id, True)

    assert _counts(client, auth_headers, user_id) == {
        "all": 1,
        "reading": 0,
        "not_started": 0,
        "finished": 1,
    }


def test_finishing_an_open_book_takes_it_out_of_reading(client, auth_headers, tmp_path):
    """The case that was structurally impossible before: a book you've opened
    could never leave the Reading filter."""
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)
    client.put(
        f"/books/{book_id}/position", headers=auth_headers, json={"user_id": user_id, "block_index": 1}
    )

    assert _counts(client, auth_headers, user_id)["reading"] == 1

    _set_finished(client, auth_headers, book_id, True)
    counts = _counts(client, auth_headers, user_id)

    assert counts["reading"] == 0
    assert counts["finished"] == 1


def test_reopening_clears_the_timestamp(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)

    _set_finished(client, auth_headers, book_id, True)
    assert _set_finished(client, auth_headers, book_id, False)["finished_at"] is None
    assert _counts(client, auth_headers, user_id)["finished"] == 0


def test_remarking_keeps_the_original_finish_date(client, auth_headers, tmp_path):
    """When you finished a book is a fact; a stray second click must not move it."""
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)

    first = _set_finished(client, auth_headers, book_id, True)["finished_at"]
    again = _set_finished(client, auth_headers, book_id, True)["finished_at"]

    assert first == again


def test_finished_is_optional_and_other_patches_still_work(client, auth_headers, tmp_path):
    """A title edit must not silently reopen a finished book."""
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)
    _set_finished(client, auth_headers, book_id, True)

    res = client.patch(f"/books/{book_id}", headers=auth_headers, json={"title": "Renamed"})
    assert res.status_code == 200
    assert res.json()["title"] == "Renamed"
    assert res.json()["finished_at"] is not None


def test_finished_book_drops_out_of_the_books_list_filters(client, auth_headers, tmp_path):
    """percent is what the tile draws its 100% bar from."""
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)
    _set_finished(client, auth_headers, book_id, True)

    listed = client.get("/books", headers=auth_headers, params={"user_id": user_id}).json()[0]
    assert listed["id"] == book_id
    assert listed["finished_at"] is not None
