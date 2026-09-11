"""Saved vocabulary words (spec §5.1 — the vocabulary increment).

Service-level tests exercise the DB logic directly against a fresh
migrated connection (mirrors test_ingest_pipeline.py's _fresh_conn pattern).
Route-level tests go through the real HTTP app, since they need a real
imported book (block/page data) to prove context source_label formatting.
"""

from app.config import settings
from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import vocabulary

# A real bundled-lexicon entry with a full definition/example/synonyms/simpler
# (cefr_wordlist.csv), so snapshot tests have real data to check against.
KNOWN_WORD = "abandon"
KNOWN_LEMMA = "abandon"
INFLECTED_FORM = "abandoned"  # -> lemmatises to "abandon" via the -ed rule
UNKNOWN_WORD = "zzznotaword"


def _fresh_conn(tmp_path, name="vocab_test.db"):
    settings.db_path = str(tmp_path / name)
    conn = get_connection()
    run_migrations(conn)
    return conn


def _make_user(conn, user_id="u1"):
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) "
        "VALUES (?, 'Test User', 'en', 'en', '2026-01-01T00:00:00Z')",
        (user_id,),
    )
    conn.commit()
    return user_id


# ---------------------------------------------------------------- save_word


def test_save_word_snapshots_lexicon_fields(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)

    result = vocabulary.save_word(
        conn, user_id=user_id, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None
    )
    assert result is not None
    row, already_existed = result
    assert already_existed is False
    assert row["lemma"] == KNOWN_LEMMA
    assert row["cefr"] == "B2"
    assert row["pos"] == "verb"
    assert row["definition"]
    assert row["example"]
    assert row["simpler"] == "leave"


def test_save_word_not_in_lexicon_returns_none(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    result = vocabulary.save_word(
        conn, user_id=user_id, word=UNKNOWN_WORD, sentence=None, book_id=None, block_index=None
    )
    assert result is None


def test_save_word_twice_does_not_duplicate_and_flags_already_existed(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)

    first = vocabulary.save_word(
        conn, user_id=user_id, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None
    )
    second = vocabulary.save_word(
        conn, user_id=user_id, word=INFLECTED_FORM, sentence=None, book_id=None, block_index=None
    )
    assert first is not None and second is not None
    row1, existed1 = first
    row2, existed2 = second
    assert existed1 is False
    assert existed2 is True
    assert row1["id"] == row2["id"]

    all_rows = vocabulary.list_words(conn, user_id)
    assert len(all_rows) == 1


def test_save_word_with_no_context_creates_word_with_zero_contexts(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    row, _ = vocabulary.save_word(
        conn, user_id=user_id, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None
    )
    assert vocabulary.context_count(conn, row["id"]) == 0


def test_save_word_is_per_user_not_global(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_a = _make_user(conn, "u1")
    user_b = _make_user(conn, "u2")

    vocabulary.save_word(conn, user_id=user_a, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None)
    vocabulary.save_word(conn, user_id=user_b, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None)

    assert len(vocabulary.list_words(conn, user_a)) == 1
    assert len(vocabulary.list_words(conn, user_b)) == 1
    assert vocabulary.list_words(conn, user_a)[0]["id"] != vocabulary.list_words(conn, user_b)[0]["id"]


# ---------------------------------------------------------------- lookups


def test_get_word_row_resolves_inflected_form_to_saved_lemma(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    vocabulary.save_word(conn, user_id=user_id, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None)

    row = vocabulary.get_word_row(conn, user_id, INFLECTED_FORM)
    assert row is not None
    assert row["lemma"] == KNOWN_LEMMA


def test_get_word_row_returns_none_when_not_saved(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    assert vocabulary.get_word_row(conn, user_id, KNOWN_WORD) is None


def test_get_word_row_does_not_leak_across_users(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_a = _make_user(conn, "u1")
    user_b = _make_user(conn, "u2")
    vocabulary.save_word(conn, user_id=user_a, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None)
    assert vocabulary.get_word_row(conn, user_b, KNOWN_WORD) is None


# ---------------------------------------------------------------- notes


def test_add_and_delete_note(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    row, _ = vocabulary.save_word(conn, user_id=user_id, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None)

    n1 = vocabulary.add_note(conn, row["id"], "first note")
    n2 = vocabulary.add_note(conn, row["id"], "second note")
    notes = vocabulary.get_notes(conn, row["id"])
    assert [n["text"] for n in notes] == ["first note", "second note"]

    assert vocabulary.delete_note(conn, row["id"], n1["id"]) is True
    remaining = vocabulary.get_notes(conn, row["id"])
    assert [n["text"] for n in remaining] == ["second note"]

    # deleting the same note again fails cleanly
    assert vocabulary.delete_note(conn, row["id"], n1["id"]) is False
    assert vocabulary.delete_note(conn, row["id"], n2["id"]) is True


# ---------------------------------------------------------------- tags


def test_add_tag_is_idempotent(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    row, _ = vocabulary.save_word(conn, user_id=user_id, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None)

    vocabulary.add_tag(conn, row["id"], "IELTS")
    tags = vocabulary.add_tag(conn, row["id"], "IELTS")
    assert tags == ["IELTS"]


def test_remove_tag_never_added_does_not_error(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    row, _ = vocabulary.save_word(conn, user_id=user_id, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None)

    tags = vocabulary.remove_tag(conn, row["id"], "never-added")
    assert tags == []


# ---------------------------------------------------------------- delete


def test_delete_word_cascades_contexts_notes_tags(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    row, _ = vocabulary.save_word(conn, user_id=user_id, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None)
    vocabulary.add_note(conn, row["id"], "a note")
    vocabulary.add_tag(conn, row["id"], "a-tag")

    assert vocabulary.delete_word(conn, user_id, row["id"]) is True
    assert vocabulary.get_word_row(conn, user_id, KNOWN_WORD) is None
    assert vocabulary.get_notes(conn, row["id"]) == []
    assert vocabulary.get_tags(conn, row["id"]) == []


def test_delete_word_by_non_owner_fails_and_leaves_word_intact(tmp_path):
    conn = _fresh_conn(tmp_path)
    owner = _make_user(conn, "u1")
    other = _make_user(conn, "u2")
    row, _ = vocabulary.save_word(conn, user_id=owner, word=KNOWN_WORD, sentence=None, book_id=None, block_index=None)

    assert vocabulary.delete_word(conn, other, row["id"]) is False
    assert vocabulary.get_word_row(conn, owner, KNOWN_WORD) is not None


# ---------------------------------------------------------------- routes


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
        "\n\n".join(f"Paragraph number {i} decided to abandon the plan entirely." for i in range(n_paragraphs)),
        encoding="utf-8",
    )
    book_id = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    ).json()[0]["id"]
    return user_id, book_id


def test_vocabulary_routes_require_token(client):
    res = client.get("/vocabulary", params={"user_id": "u"})
    assert res.status_code == 401


def test_save_word_route_rejects_unknown_word(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/vocabulary", headers=auth_headers, json={"user_id": user_id, "word": UNKNOWN_WORD}
    )
    assert res.status_code == 422


def test_save_word_route_end_to_end_with_real_book_context(client, auth_headers, tmp_path):
    user_id, book_id = _import_book(client, auth_headers, tmp_path)

    res = client.post(
        "/vocabulary",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "word": KNOWN_WORD,
            "sentence": "Paragraph number 0 decided to abandon the plan entirely.",
            "book_id": book_id,
            "block_index": 0,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["already_saved"] is False
    assert body["word"]["lemma"] == KNOWN_LEMMA
    assert body["word"]["context_count"] == 1

    # saving the exact same word+sentence again is idempotent for the word,
    # but not for the context (dup-context guard already covered at service level)
    res2 = client.post(
        "/vocabulary",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "word": KNOWN_WORD,
            "sentence": "Paragraph number 0 decided to abandon the plan entirely.",
            "book_id": book_id,
            "block_index": 0,
        },
    )
    assert res2.json()["already_saved"] is True

    detail = client.get(f"/vocabulary/by-word/{KNOWN_WORD}", headers=auth_headers, params={"user_id": user_id})
    assert detail.status_code == 200
    detail_body = detail.json()
    assert len(detail_body["contexts"]) == 1  # same book+block -> not duplicated
    # the import pipeline titles a plain .txt book from its filename stem ("book.txt" -> "book")
    assert detail_body["contexts"][0]["source_label"].startswith("book · p.")


def test_save_word_appends_second_context_from_a_different_block(client, auth_headers, tmp_path):
    user_id, book_id = _import_book(client, auth_headers, tmp_path)

    client.post(
        "/vocabulary",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "word": KNOWN_WORD,
            "sentence": "Paragraph number 0 decided to abandon the plan entirely.",
            "book_id": book_id,
            "block_index": 0,
        },
    )
    res = client.post(
        "/vocabulary",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "word": KNOWN_WORD,
            "sentence": "Paragraph number 1 decided to abandon the plan entirely.",
            "book_id": book_id,
            "block_index": 1,
        },
    )
    assert res.json()["already_saved"] is True  # same word, still just one already-saved word...
    assert res.json()["word"]["context_count"] == 2  # ...but a second, distinct context


def test_by_word_404_for_unsaved_word(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    res = client.get(f"/vocabulary/by-word/{KNOWN_WORD}", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 404


def test_notes_and_tags_routes(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    saved = client.post(
        "/vocabulary", headers=auth_headers, json={"user_id": user_id, "word": KNOWN_WORD}
    ).json()
    vocab_word_id = saved["word"]["id"]

    note_res = client.post(
        f"/vocabulary/{vocab_word_id}/notes",
        headers=auth_headers,
        params={"user_id": user_id},
        json={"text": "remember this"},
    )
    assert note_res.status_code == 201
    note_id = note_res.json()["id"]

    tag_res = client.post(
        f"/vocabulary/{vocab_word_id}/tags",
        headers=auth_headers,
        params={"user_id": user_id},
        json={"tag": "workplace"},
    )
    assert tag_res.status_code == 200
    assert tag_res.json() == ["workplace"]

    detail = client.get(
        f"/vocabulary/by-word/{KNOWN_WORD}", headers=auth_headers, params={"user_id": user_id}
    ).json()
    assert detail["notes"][0]["text"] == "remember this"
    assert detail["tags"] == ["workplace"]

    del_note = client.delete(
        f"/vocabulary/{vocab_word_id}/notes/{note_id}", headers=auth_headers, params={"user_id": user_id}
    )
    assert del_note.status_code == 204

    del_tag = client.delete(
        f"/vocabulary/{vocab_word_id}/tags/workplace", headers=auth_headers, params={"user_id": user_id}
    )
    assert del_tag.status_code == 200
    assert del_tag.json() == []
