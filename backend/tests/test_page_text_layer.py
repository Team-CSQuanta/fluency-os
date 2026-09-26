"""The selectable text over a rendered page.

A page image is a picture, so nothing on it can be selected, looked up or
highlighted. This layer is what makes those possible, and the one thing it has
to get right is that the boxes land where the ink is — a layer that is off by
a few per cent is worse than none, because selecting a word gives you its
neighbour.
"""

import fitz
import pytest


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


def _png_size(data: bytes) -> tuple[int, int]:
    """Width and height out of the PNG header, rather than adding an image
    library to the test dependencies to learn two numbers."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    assert data[12:16] == b"IHDR"
    return (
        int.from_bytes(data[16:20], "big"),
        int.from_bytes(data[20:24], "big"),
    )


def _import(client, auth_headers, user_id, source):
    res = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    )
    assert res.status_code == 202
    return res.json()[0]["id"]


@pytest.fixture()
def pdf_book(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Layered.pdf"
    _write_pdf(source, ["The quick brown fox.", "Second page here."])
    return _import(client, auth_headers, user_id, source)


def test_the_layer_carries_every_word_on_the_page(client, auth_headers, pdf_book):
    res = client.get(f"/books/{pdf_book}/page/1/text-layer", headers=auth_headers)
    assert res.status_code == 200, res.text
    layer = res.json()
    assert [w["t"] for w in layer["words"]] == ["The", "quick", "brown", "fox."]


def test_the_boxes_are_in_the_rendered_images_own_pixels(client, auth_headers, pdf_book):
    """The whole point. The client draws the layer over the PNG, so the two
    have to be in the same coordinate system — if the layer is in PDF points
    and the image is at 2x, every box lands at half the right place."""
    layer = client.get(f"/books/{pdf_book}/page/1/text-layer", headers=auth_headers).json()
    png = client.get(f"/books/{pdf_book}/page/1/image", headers=auth_headers)
    assert png.status_code == 200
    width, height = _png_size(png.content)

    assert abs(layer["width"] - width) <= 1, (layer["width"], width)
    assert abs(layer["height"] - height) <= 1, (layer["height"], height)
    # And nothing sits outside the page it is supposed to be on.
    for w in layer["words"]:
        assert 0 <= w["x"] and w["x"] + w["w"] <= width + 1, w
        assert 0 <= w["y"] and w["y"] + w["h"] <= height + 1, w


def test_words_on_one_line_share_a_line_id_and_run_left_to_right(client, auth_headers, pdf_book):
    """Without a line id the client cannot tell a line break from a space, and
    a selection spanning two lines copies as "fox.Second"."""
    layer = client.get(f"/books/{pdf_book}/page/1/text-layer", headers=auth_headers).json()
    words = layer["words"]
    assert len({w["ln"] for w in words}) == 1, "one line of text, one line id"
    xs = [w["x"] for w in words]
    assert xs == sorted(xs), "reading order, left to right"


def test_each_page_gets_its_own_layer(client, auth_headers, pdf_book):
    second = client.get(f"/books/{pdf_book}/page/2/text-layer", headers=auth_headers).json()
    assert [w["t"] for w in second["words"]] == ["Second", "page", "here."]


def test_the_layer_is_cached_and_the_second_read_matches_the_first(client, auth_headers, pdf_book):
    first = client.get(f"/books/{pdf_book}/page/1/text-layer", headers=auth_headers).json()
    again = client.get(f"/books/{pdf_book}/page/1/text-layer", headers=auth_headers).json()
    assert first == again


def test_a_page_past_the_end_is_not_found(client, auth_headers, pdf_book):
    assert client.get(f"/books/{pdf_book}/page/99/text-layer", headers=auth_headers).status_code == 404
    assert client.get(f"/books/{pdf_book}/page/0/text-layer", headers=auth_headers).status_code == 404


def test_a_reflowable_book_has_no_page_to_lay_text_over(client, auth_headers, tmp_path):
    """EPUB and plain text never had a printed page, so there is nothing to
    render and nothing to lay over it — said plainly rather than 500-ing."""
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Plain.txt"
    source.write_text("Just some prose, with no page of its own.\n" * 40)
    book_id = _import(client, auth_headers, user_id, source)

    res = client.get(f"/books/{book_id}/page/1/text-layer", headers=auth_headers)
    assert res.status_code == 404
    assert "PDF" in res.json()["detail"]


# --- highlights drawn on the page ------------------------------------------


def _rect(x, y, w=40, h=12):
    return {"x": x, "y": y, "w": w, "h": h}


def _user_of(client, auth_headers, book_id):
    return client.get(f"/books/{book_id}", headers=auth_headers).json()["user_id"]


def test_a_highlight_on_the_page_survives_a_round_trip(client, auth_headers, pdf_book):
    user_id = _user_of(client, auth_headers, pdf_book)
    res = client.post(
        f"/books/{pdf_book}/page-highlights",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "page": 1,
            "rects": [_rect(100, 200), _rect(100, 220)],
            "colour": "yellow",
            "style": "highlight",
            "quoted_text": "The quick brown fox.",
        },
    )
    assert res.status_code == 201, res.text
    made = res.json()
    assert len(made["rects"]) == 2, "a selection across two lines is two boxes, not one"
    assert made["rects"][1]["y"] == 220

    back = client.get(
        f"/books/{pdf_book}/page-highlights", headers=auth_headers, params={"user_id": user_id}
    ).json()
    assert [h["id"] for h in back] == [made["id"]]
    assert back[0]["quoted_text"] == "The quick brown fox."


def test_highlights_can_be_asked_for_one_page_at_a_time(client, auth_headers, pdf_book):
    """A 938-page textbook's whole set is not worth sending to draw one page."""
    user_id = _user_of(client, auth_headers, pdf_book)
    for page in (1, 2):
        client.post(
            f"/books/{pdf_book}/page-highlights",
            headers=auth_headers,
            json={
                "user_id": user_id, "page": page, "rects": [_rect(10, 10)],
                "colour": "green", "quoted_text": f"page {page}",
            },
        )
    only_two = client.get(
        f"/books/{pdf_book}/page-highlights",
        headers=auth_headers,
        params={"user_id": user_id, "page": 2},
    ).json()
    assert [h["page"] for h in only_two] == [2]
    assert len(client.get(
        f"/books/{pdf_book}/page-highlights", headers=auth_headers, params={"user_id": user_id}
    ).json()) == 2


def test_the_colour_and_style_can_be_changed_afterwards(client, auth_headers, pdf_book):
    user_id = _user_of(client, auth_headers, pdf_book)
    made = client.post(
        f"/books/{pdf_book}/page-highlights",
        headers=auth_headers,
        json={"user_id": user_id, "page": 1, "rects": [_rect(10, 10)],
              "colour": "yellow", "quoted_text": "x"},
    ).json()
    res = client.patch(
        f"/books/{pdf_book}/page-highlights/{made['id']}",
        headers=auth_headers,
        json={"colour": "purple", "style": "underline"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["colour"] == "purple"
    assert res.json()["style"] == "underline"
    assert res.json()["quoted_text"] == "x", "changing the colour must not lose the passage"


def test_a_highlight_with_nothing_to_mark_is_refused(client, auth_headers, pdf_book):
    user_id = _user_of(client, auth_headers, pdf_book)
    res = client.post(
        f"/books/{pdf_book}/page-highlights",
        headers=auth_headers,
        json={"user_id": user_id, "page": 1, "rects": [], "colour": "yellow", "quoted_text": ""},
    )
    assert res.status_code == 400


def test_a_book_with_no_printed_page_cannot_be_highlighted_on_one(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Plain.txt"
    source.write_text("Prose without pages.\n" * 40)
    book_id = _import(client, auth_headers, user_id, source)
    res = client.post(
        f"/books/{book_id}/page-highlights",
        headers=auth_headers,
        json={"user_id": user_id, "page": 1, "rects": [_rect(1, 1)],
              "colour": "yellow", "quoted_text": "x"},
    )
    assert res.status_code == 404


def test_deleting_one_leaves_the_rest(client, auth_headers, pdf_book):
    user_id = _user_of(client, auth_headers, pdf_book)
    ids = [
        client.post(
            f"/books/{pdf_book}/page-highlights",
            headers=auth_headers,
            json={"user_id": user_id, "page": 1, "rects": [_rect(10, 10 + i * 20)],
                  "colour": "blue", "quoted_text": f"h{i}"},
        ).json()["id"]
        for i in range(3)
    ]
    assert client.delete(
        f"/books/{pdf_book}/page-highlights/{ids[1]}", headers=auth_headers
    ).status_code == 204
    left = client.get(
        f"/books/{pdf_book}/page-highlights", headers=auth_headers, params={"user_id": user_id}
    ).json()
    assert [h["id"] for h in left] == [ids[0], ids[2]]
    assert client.delete(
        f"/books/{pdf_book}/page-highlights/{ids[1]}", headers=auth_headers
    ).status_code == 404


# --- simpler words in place ------------------------------------------------
#
# The reader selects a sentence on the page and asks for it in plainer
# language. Same engines and cache as the block-based route; the only
# difference is that the text arrives as text, because a selection on a
# rendered page is not a block and may cover material the extractor dropped.


def test_a_selected_passage_can_be_put_in_simpler_words(client, auth_headers, pdf_book):
    user_id = _user_of(client, auth_headers, pdf_book)
    res = client.post(
        "/reading/level-text",
        headers=auth_headers,
        json={
            "text": "Although the evaluation is comprehensive, it has limitations.",
            "mode": "inline",
            "user_id": user_id,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["original"] == "Although the evaluation is comprehensive, it has limitations."
    assert body["segments"], "a result with no segments has nothing to draw"


def test_the_same_passage_twice_is_generated_once(client, auth_headers, pdf_book):
    """Keyed on the text, so coming back to a sentence is free — which matters
    when the engine behind it is a local model taking seconds."""
    user_id = _user_of(client, auth_headers, pdf_book)
    payload = {"text": "The fundamental methodology is nevertheless sound.",
               "mode": "inline", "user_id": user_id}
    first = client.post("/reading/level-text", headers=auth_headers, json=payload).json()
    again = client.post("/reading/level-text", headers=auth_headers, json=payload).json()
    assert first["cached"] is False
    assert again["cached"] is True
    assert [s["text"] for s in first["segments"]] == [s["text"] for s in again["segments"]]


def test_an_empty_selection_is_refused_in_words_a_reader_understands(client, auth_headers):
    res = client.post(
        "/reading/level-text", headers=auth_headers, json={"text": "   ", "mode": "inline"}
    )
    assert res.status_code == 400
    assert "no text" in res.json()["detail"].lower()


def test_a_whole_page_of_text_is_refused_rather_than_attempted(client, auth_headers):
    """A local model asked for a page takes minutes and returns something
    worse than it returns for a sentence."""
    res = client.post(
        "/reading/level-text",
        headers=auth_headers,
        json={"text": "word " * 400, "mode": "inline"},
    )
    assert res.status_code == 400
    assert "too much text" in res.json()["detail"].lower()


def test_a_mode_that_needs_a_model_says_so_rather_than_failing(client, auth_headers):
    """Being offline is this app's normal state, so an unavailable engine is a
    200 that says it is unavailable — never an error."""
    res = client.post(
        "/reading/level-text",
        headers=auth_headers,
        json={"text": "A sentence to gloss.", "mode": "semantic"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    if not body["available"]:
        assert body["note"], "an unavailable result has to say why"


def test_a_label_is_pinned_where_the_original_words_are(client, auth_headers, pdf_book):
    """Both halves are stored. Covering a source's actual words with a rewrite
    and keeping no way back to what was printed would be a poor thing to do to
    someone reading it."""
    user_id = _user_of(client, auth_headers, pdf_book)
    res = client.post(
        f"/books/{pdf_book}/page-labels",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "page": 1,
            "rects": [_rect(100, 200, 300, 14)],
            "original_text": "Although the evaluation is comprehensive, it has limitations.",
            "simple_text": "The test covers a lot, but it is not perfect.",
            "mode": "inline",
        },
    )
    assert res.status_code == 201, res.text
    made = res.json()
    assert made["original_text"].startswith("Although")
    assert made["simple_text"].startswith("The test")

    back = client.get(
        f"/books/{pdf_book}/page-labels",
        headers=auth_headers,
        params={"user_id": user_id, "page": 1},
    ).json()
    assert [l["id"] for l in back] == [made["id"]]


def test_a_label_with_no_simpler_words_is_refused(client, auth_headers, pdf_book):
    """An engine that hands back nothing has not simplified anything, and
    covering the page with an empty box would be worse than doing nothing."""
    user_id = _user_of(client, auth_headers, pdf_book)
    res = client.post(
        f"/books/{pdf_book}/page-labels",
        headers=auth_headers,
        json={"user_id": user_id, "page": 1, "rects": [_rect(1, 1)],
              "original_text": "x", "simple_text": "   ", "mode": "inline"},
    )
    assert res.status_code == 400


def test_removing_a_label_leaves_the_page_as_printed(client, auth_headers, pdf_book):
    user_id = _user_of(client, auth_headers, pdf_book)
    made = client.post(
        f"/books/{pdf_book}/page-labels",
        headers=auth_headers,
        json={"user_id": user_id, "page": 1, "rects": [_rect(1, 1)],
              "original_text": "hard", "simple_text": "easy", "mode": "inline"},
    ).json()
    assert client.delete(
        f"/books/{pdf_book}/page-labels/{made['id']}", headers=auth_headers
    ).status_code == 204
    assert client.get(
        f"/books/{pdf_book}/page-labels", headers=auth_headers, params={"user_id": user_id}
    ).json() == []


# --- the label is the AI's work, or there is no label -----------------------
#
# A label is written OVER the printed words. The side panel can honestly
# degrade to a wordlist substitution, because it shows its result next to the
# original and says what it did; a label cannot, because covering a sentence
# with a copy of itself looks like the feature ran and did nothing.


def _fake_ai(monkeypatch, reply):
    from app.services import vocabulary_ai

    monkeypatch.setattr(vocabulary_ai, "_llm_target", lambda conn, user_id: {"provider": "local"})
    monkeypatch.setattr(
        vocabulary_ai,
        "_generate_json",
        lambda target, system, user, **kw: reply,
    )


def _configure_model(client, auth_headers, user_id):
    """A downloaded model, as far as the leveling engine is concerned."""
    from app.config import settings
    from app.db import get_connection

    conn = get_connection(settings.db_path)
    conn.execute(
        "INSERT INTO user_settings (user_id, llm_model_id) VALUES (?, ?) "
        "ON CONFLICT(user_id) DO UPDATE SET llm_model_id = excluded.llm_model_id",
        (user_id, "some-local-model"),
    )
    conn.commit()
    conn.close()


def test_a_label_asked_for_with_no_ai_is_refused_rather_than_downgraded(
    client, auth_headers, pdf_book
):
    """503 is the answer the app already knows how to offer to start the AI
    from — where a 200 carrying a wordlist substitution would be pinned over
    the page as though the model had written it."""
    user_id = _user_of(client, auth_headers, pdf_book)
    res = client.post(
        "/reading/level-text",
        headers=auth_headers,
        json={
            "text": "Although the evaluation is comprehensive, it has limitations.",
            "mode": "contextual",
            "user_id": user_id,
            "require_model": True,
        },
    )
    assert res.status_code == 503, res.text
    detail = res.json()["detail"]
    # The reader has to be able to act on it, and the renderer decides whether
    # to offer the launch dialog by reading this sentence.
    assert "model" in detail.lower()


def test_a_label_cannot_be_asked_for_from_the_wordlist(client, auth_headers, pdf_book):
    user_id = _user_of(client, auth_headers, pdf_book)
    res = client.post(
        "/reading/level-text",
        headers=auth_headers,
        json={"text": "It is comprehensive.", "mode": "inline",
              "user_id": user_id, "require_model": True},
    )
    assert res.status_code == 400
    assert "AI" in res.json()["detail"]


def test_the_ai_writes_the_label_and_says_what_it_replaced(
    client, auth_headers, pdf_book, monkeypatch
):
    user_id = _user_of(client, auth_headers, pdf_book)
    _configure_model(client, auth_headers, user_id)
    _fake_ai(
        monkeypatch,
        {
            "rewrite": "The test covers a lot, but it is not perfect.",
            "changes": [
                {"from": "comprehensive", "to": "covers a lot"},
                {"from": "limitations", "to": "not perfect"},
            ],
        },
    )

    res = client.post(
        "/reading/level-text",
        headers=auth_headers,
        json={
            "text": "Although the evaluation is comprehensive, it has limitations.",
            "mode": "contextual",
            "user_id": user_id,
            "require_model": True,
        },
    )

    assert res.status_code == 200, res.text
    body = res.json()
    assert "".join(s["text"] for s in body["segments"]) == (
        "The test covers a lot, but it is not perfect."
    )
    assert body["available"] is True
    assert body["served_mode"] == "contextual"
    # The ledger: what was replaced, and by what.
    assert body["substitutions"] == [
        {"from_text": "comprehensive", "to_text": "covers a lot"},
        {"from_text": "limitations", "to_text": "not perfect"},
    ]


def test_an_ai_that_changed_nothing_says_so_instead_of_covering_the_page(
    client, auth_headers, pdf_book, monkeypatch
):
    user_id = _user_of(client, auth_headers, pdf_book)
    _configure_model(client, auth_headers, user_id)
    same = "The cat sat on the mat."
    _fake_ai(monkeypatch, {"rewrite": same, "changes": []})

    body = client.post(
        "/reading/level-text",
        headers=auth_headers,
        json={"text": same, "mode": "contextual", "user_id": user_id, "require_model": True},
    ).json()

    assert "".join(s["text"] for s in body["segments"]) == same
    assert body["note"]


def test_an_ai_that_is_not_launched_reaches_the_reader_as_such(
    client, auth_headers, pdf_book, monkeypatch
):
    """The second gate: downloaded is not running. This is the case the
    reader's screenshot showed, and it must not turn into a silent rewrite."""
    from app.services import vocabulary_ai
    from app.services.voice.errors import EngineUnavailable

    user_id = _user_of(client, auth_headers, pdf_book)
    _configure_model(client, auth_headers, user_id)

    def not_launched(conn, user_id):
        raise EngineUnavailable("The AI model is downloaded but not running — launch it first.")

    monkeypatch.setattr(vocabulary_ai, "_llm_target", not_launched)

    res = client.post(
        "/reading/level-text",
        headers=auth_headers,
        json={"text": "A difficult sentence about photometry.", "mode": "contextual",
              "user_id": user_id, "require_model": True},
    )

    assert res.status_code == 503
    assert "launch" in res.json()["detail"].lower()


def test_a_rewrite_is_only_marked_up_where_the_words_really_are(monkeypatch):
    """The underline has to point at text that is actually in the rewrite —
    a model listing a change it did not make would otherwise mark the wrong
    words, or crash on a phrase that is not there."""
    from app.services.leveling.llm_engine import weave

    segments = weave(
        "It is easy to chain moves.",
        [("possible", "easy"), ("transformations", "moves"), ("invented", "nowhere in here")],
    )
    assert "".join(s.text for s in segments) == "It is easy to chain moves."
    assert [(s.text, s.original) for s in segments if s.original] == [
        ("easy", "possible"),
        ("moves", "transformations"),
    ]


def test_the_same_replacement_twice_marks_two_different_places():
    from app.services.leveling.llm_engine import weave

    segments = weave("a big dog and a big cat", [("large", "big"), ("huge", "big")])
    assert [(s.text, s.original) for s in segments if s.original] == [
        ("big", "large"),
        ("big", "huge"),
    ]


def test_a_reader_is_never_told_to_go_and_start_a_conversation(
    client, auth_headers, pdf_book, monkeypatch
):
    """The gates are shared with Conversation and phrased for it. What is
    missing and what to do about it is the same; the feature named is not."""
    from app.services import vocabulary_ai
    from app.services.voice.errors import EngineUnavailable

    user_id = _user_of(client, auth_headers, pdf_book)
    _configure_model(client, auth_headers, user_id)

    def not_downloaded(conn, user_id):
        raise EngineUnavailable(
            "LLM model not downloaded yet — download it in Settings before starting a conversation."
        )

    monkeypatch.setattr(vocabulary_ai, "_llm_target", not_downloaded)

    res = client.post(
        "/reading/level-text",
        headers=auth_headers,
        json={"text": "A difficult sentence.", "mode": "contextual",
              "user_id": user_id, "require_model": True},
    )

    detail = res.json()["detail"]
    assert res.status_code == 503
    assert "conversation" not in detail.lower()
    assert "Settings" in detail
