"""Where a word was saved from.

A word met on a printed page has no block to point at — the selection is a
run of boxes on an image, not a paragraph the extractor recorded. Before
this, every word saved while reading a PDF was stored with no source at all:
the entry could not say where it came from, which is the whole value of
saving it in the first place.
"""

PARAGRAPH = " ".join(["word"] * 120)
SAMPLE = f"The ubiquitous solution.\n\n{PARAGRAPH}\n\n{PARAGRAPH}"


def _user(client, auth_headers):
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


def _book(client, auth_headers, tmp_path, user_id, name="Practical SQL"):
    source = tmp_path / f"{name}.txt"
    source.write_text(SAMPLE, encoding="utf-8")
    res = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    )
    assert res.status_code == 202
    return res.json()[0]["id"]


def _save(client, auth_headers, **payload):
    res = client.post("/vocabulary", headers=auth_headers, json=payload)
    assert res.status_code in (200, 201), res.text
    return res.json()


def _contexts(client, auth_headers, user_id, word):
    res = client.get(f"/vocabulary/by-word/{word}", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200, res.text
    return res.json()["contexts"]


def test_a_word_saved_from_a_printed_page_records_where_it_came_from(
    client, auth_headers, tmp_path
):
    user_id = _user(client, auth_headers)
    book_id = _book(client, auth_headers, tmp_path, user_id)

    _save(
        client,
        auth_headers,
        user_id=user_id,
        word="ubiquitous",
        sentence="The ubiquitous solution.",
        book_id=book_id,
        page=236,
    )

    contexts = _contexts(client, auth_headers, user_id, "ubiquitous")
    assert len(contexts) == 1
    assert contexts[0]["snippet"] == "The ubiquitous solution."
    assert contexts[0]["page"] == 236
    assert contexts[0]["source_label"] == "Practical SQL · p.236"
    assert contexts[0]["book_id"] == book_id


def test_the_same_page_twice_is_still_one_context(client, auth_headers, tmp_path):
    user_id = _user(client, auth_headers)
    book_id = _book(client, auth_headers, tmp_path, user_id)
    for _ in range(2):
        _save(
            client,
            auth_headers,
            user_id=user_id,
            word="ubiquitous",
            sentence="The ubiquitous solution.",
            book_id=book_id,
            page=236,
        )
    assert len(_contexts(client, auth_headers, user_id, "ubiquitous")) == 1


def test_a_different_page_of_the_same_book_is_a_second_context(client, auth_headers, tmp_path):
    """Meeting a word again somewhere else is worth recording — that is what
    the entry's list of contexts is for."""
    user_id = _user(client, auth_headers)
    book_id = _book(client, auth_headers, tmp_path, user_id)
    _save(client, auth_headers, user_id=user_id, word="ubiquitous",
          sentence="The ubiquitous solution.", book_id=book_id, page=236)
    _save(client, auth_headers, user_id=user_id, word="ubiquitous",
          sentence="Another ubiquitous line.", book_id=book_id, page=400)
    pages = sorted(c["page"] for c in _contexts(client, auth_headers, user_id, "ubiquitous"))
    assert pages == [236, 400]


def test_a_block_still_works_and_now_carries_its_page_too(client, auth_headers, tmp_path):
    """The reflowed view sends a block. That context used to know its page
    only inside its label; now the page is a column like any other."""
    user_id = _user(client, auth_headers)
    book_id = _book(client, auth_headers, tmp_path, user_id)
    _save(client, auth_headers, user_id=user_id, word="ubiquitous",
          sentence="The ubiquitous solution.", book_id=book_id, block_index=0)
    ctx = _contexts(client, auth_headers, user_id, "ubiquitous")[0]
    assert ctx["block_index"] == 0
    assert ctx["page"] == 1
    assert ctx["source_label"].startswith("Practical SQL · p.")


def test_a_word_with_no_source_at_all_saves_without_a_context(client, auth_headers):
    """Saving from somewhere with no location is still saving the word."""
    user_id = _user(client, auth_headers)
    _save(client, auth_headers, user_id=user_id, word="ubiquitous")
    assert _contexts(client, auth_headers, user_id, "ubiquitous") == []
