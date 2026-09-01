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


def _import_txt(client, auth_headers, tmp_path, paragraphs):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "search_book.txt"
    source.write_text("\n\n".join(paragraphs), encoding="utf-8")
    book_id = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    ).json()[0]["id"]
    return user_id, book_id


def test_search_requires_token(client):
    res = client.get("/books/x/search", params={"q": "reticent"})
    assert res.status_code == 401


def test_search_finds_matching_paragraph_with_snippet(client, auth_headers, tmp_path):
    _user_id, book_id = _import_txt(
        client,
        auth_headers,
        tmp_path,
        [
            "The house had four generations living in it.",
            "She was reticent about the findings, even with her own team.",
            "By spring the arguments had ossified into procedure.",
        ],
    )

    res = client.get(f"/books/{book_id}/search", headers=auth_headers, params={"q": "reticent"})
    assert res.status_code == 200
    hits = res.json()
    assert len(hits) == 1
    assert hits[0]["block_index"] == 1
    assert hits[0]["page"] == 1

    matched_texts = [seg["text"] for seg in hits[0]["snippet"] if seg["matched"]]
    assert any("reticent" in t.lower() for t in matched_texts)


def test_search_no_matches_returns_empty(client, auth_headers, tmp_path):
    _user_id, book_id = _import_txt(client, auth_headers, tmp_path, ["Nothing interesting here at all."])
    res = client.get(f"/books/{book_id}/search", headers=auth_headers, params={"q": "xylophone"})
    assert res.status_code == 200
    assert res.json() == []


def test_search_empty_query_returns_empty(client, auth_headers, tmp_path):
    _user_id, book_id = _import_txt(client, auth_headers, tmp_path, ["Some text here."])
    res = client.get(f"/books/{book_id}/search", headers=auth_headers, params={"q": "   "})
    assert res.status_code == 200
    assert res.json() == []


def test_search_ranks_more_frequent_matches_higher(client, auth_headers, tmp_path):
    _user_id, book_id = _import_txt(
        client,
        auth_headers,
        tmp_path,
        [
            "The word appears once in this paragraph.",
            "The word word word appears three times right here in this one, the word again.",
        ],
    )
    res = client.get(f"/books/{book_id}/search", headers=auth_headers, params={"q": "word"})
    hits = res.json()
    assert len(hits) == 2
    # bm25 ranks the paragraph with more occurrences of the term first.
    assert hits[0]["block_index"] == 1


def test_search_operators_and_quotes_do_not_break_query(client, auth_headers, tmp_path):
    _user_id, book_id = _import_txt(
        client, auth_headers, tmp_path, ['A paragraph that mentions AND and "quoted" text and don\'t forget it.']
    )
    for q in ['AND OR NOT', '"; DROP TABLE books; --', "don't", 'quoted "text"']:
        res = client.get(f"/books/{book_id}/search", headers=auth_headers, params={"q": q})
        assert res.status_code == 200  # never a 500, regardless of input


def test_search_attaches_chapter_label_for_epub(client, auth_headers, tmp_path):
    from ebooklib import epub

    book = epub.EpubBook()
    book.set_identifier("search-epub-test")
    book.set_title("Search Book")
    book.set_language("en")
    c1 = epub.EpubHtml(title="Ch1", file_name="c1.xhtml", lang="en")
    c1.content = "<h1>Chapter One</h1><p>Nothing notable here.</p>"
    c2 = epub.EpubHtml(title="Ch2", file_name="c2.xhtml", lang="en")
    c2.content = "<h1>Chapter Two</h1><p>She was reticent about the results.</p>"
    book.add_item(c1)
    book.add_item(c2)
    book.toc = (c1, c2)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", c1, c2]
    path = tmp_path / "search.epub"
    epub.write_epub(str(path), book, {"epub3_pages": False})

    user_id = _create_user(client, auth_headers)
    book_id = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(path)]}
    ).json()[0]["id"]

    hits = client.get(f"/books/{book_id}/search", headers=auth_headers, params={"q": "reticent"}).json()
    assert len(hits) == 1
    assert hits[0]["chapter_label"] == "Chapter Two"
