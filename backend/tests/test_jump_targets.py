"""A jump target must land where it says it does.

Bookmarks, highlights and search hits each report a `page` alongside their
`block_index`, and the reader jumps to that page and then scrolls to that
block. If the two disagree the block simply isn't on the loaded page and the
scroll silently does nothing — so the invariant is: the page a row reports
must be the page GET /books/{id}/page actually returns that block on.

Covers both pagination paths: word-count estimates (TXT/EPUB) and the native
printed pages a PDF carries.
"""

WORDS = " ".join(["word"] * 120)
# Comfortably more than one 275-word page, so blocks land on several pages.
SAMPLE = "\n\n".join(f"Block {i}. {WORDS}" for i in range(20))


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


def _import(client, auth_headers, tmp_path, user_id):
    source = tmp_path / "Jump Sample.txt"
    source.write_text(SAMPLE, encoding="utf-8")
    res = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    )
    assert res.status_code == 202
    return res.json()[0]["id"]


def _blocks_on_page(client, auth_headers, book_id, page):
    res = client.get(f"/books/{book_id}/page", headers=auth_headers, params={"page": page})
    assert res.status_code == 200
    return {b["block_index"] for b in res.json()["blocks"]}


def test_bookmark_page_contains_its_block(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)

    total_blocks = client.get(f"/books/{book_id}", headers=auth_headers).json()["total_blocks"]
    assert total_blocks > 1

    for block_index in range(total_blocks):
        created = client.post(
            f"/books/{book_id}/bookmarks",
            headers=auth_headers,
            json={"user_id": user_id, "block_index": block_index, "label": f"b{block_index}"},
        )
        assert created.status_code == 201
        body = created.json()
        assert body["block_index"] in _blocks_on_page(
            client, auth_headers, book_id, body["page"]
        ), f"bookmark on block {block_index} reports page {body['page']} but isn't on it"


def test_highlight_page_contains_its_block(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)
    total_blocks = client.get(f"/books/{book_id}", headers=auth_headers).json()["total_blocks"]

    for block_index in range(total_blocks):
        created = client.post(
            f"/books/{book_id}/highlights",
            headers=auth_headers,
            json={
                "user_id": user_id,
                "block_index": block_index,
                "start_char": 0,
                "end_char": 5,
                "colour": "yellow",
                "quoted_text": "Block",
            },
        )
        assert created.status_code == 201
        body = created.json()
        assert body["block_index"] in _blocks_on_page(client, auth_headers, book_id, body["page"])


def test_search_hit_page_contains_its_block(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)

    hits = client.get(f"/books/{book_id}/search", headers=auth_headers, params={"q": "Block"}).json()
    assert hits

    for hit in hits:
        assert hit["block_index"] in _blocks_on_page(
            client, auth_headers, book_id, hit["page"]
        ), f"search hit on block {hit['block_index']} reports page {hit['page']} but isn't on it"


def test_chapter_page_contains_its_start_block(client, auth_headers, tmp_path):
    """The Contents panel jumps by page too."""
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)

    for chapter in client.get(f"/books/{book_id}/toc", headers=auth_headers).json():
        assert chapter["start_block"] in _blocks_on_page(
            client, auth_headers, book_id, chapter["page"]
        )


def test_resume_position_page_contains_its_block(client, auth_headers, tmp_path):
    """Reopening a book is the same jump, and the one that matters most."""
    user_id = _create_user(client, auth_headers)
    book_id = _import(client, auth_headers, tmp_path, user_id)
    total_blocks = client.get(f"/books/{book_id}", headers=auth_headers).json()["total_blocks"]

    for block_index in (0, total_blocks // 2, total_blocks - 1):
        assert (
            client.put(
                f"/books/{book_id}/position",
                headers=auth_headers,
                json={"user_id": user_id, "block_index": block_index},
            ).status_code
            == 204
        )
        pos = client.get(
            f"/books/{book_id}/position", headers=auth_headers, params={"user_id": user_id}
        ).json()
        assert pos["block_index"] in _blocks_on_page(client, auth_headers, book_id, pos["page"])
