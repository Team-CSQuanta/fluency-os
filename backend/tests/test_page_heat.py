"""Difficulty heat on the printed page: the same judgements /reading/heat
makes for a block, in the coordinates a page has."""

import fitz
import pytest


def _create_user(client, auth_headers, cefr=None):
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
    user_id = res.json()["id"]
    if cefr:
        assert client.patch(
            f"/users/{user_id}/placement", headers=auth_headers, json={"cefr_level": cefr}
        ).status_code == 200
    return user_id


def _write_pdf(path, page_bodies):
    doc = fitz.open()
    for body in page_bodies:
        page = doc.new_page()
        page.insert_text((72, 200), body, fontsize=11)
    doc.save(str(path))
    doc.close()


@pytest.fixture()
def pdf_book(client, auth_headers, tmp_path):
    """A page mixing plain words with ones above B1, including one carrying
    punctuation — every real page has those and the box holds them too."""
    user_id = _create_user(client, auth_headers)
    source = tmp_path / "Heated.pdf"
    _write_pdf(source, ["The water is ubiquitous, and comprehensive."])
    res = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    )
    assert res.status_code == 202
    return res.json()[0]["id"], user_id


def _heat(client, auth_headers, book_id, page=1, **params):
    res = client.get(
        f"/books/{book_id}/page/{page}/heat", headers=auth_headers, params=params
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_only_the_words_above_level_come_back(client, auth_headers, pdf_book):
    book_id, _ = pdf_book
    heat = _heat(client, auth_headers, book_id, target_cefr="B1")
    assert [w["word"] for w in heat["words"]] == ["ubiquitous", "comprehensive"]
    assert heat["total_above_level"] == 2
    assert heat["enabled"] is True


def test_the_index_points_at_the_box_the_client_already_holds(client, auth_headers, pdf_book):
    """The client draws from the text layer's word list, so an index that does
    not line up with it tints the wrong word — which is worse than no tint."""
    book_id, _ = pdf_book
    layer = client.get(f"/books/{book_id}/page/1/text-layer", headers=auth_headers).json()
    heat = _heat(client, auth_headers, book_id, target_cefr="B1")
    for hot in heat["words"]:
        assert hot["word"] in layer["words"][hot["i"]]["t"]


def test_a_box_carrying_punctuation_is_still_judged(client, auth_headers, pdf_book):
    """"ubiquitous," is one box on the page. Judged as it stands it is not a
    word in any lexicon, and the hardest word on the page would go untinted."""
    book_id, _ = pdf_book
    layer = client.get(f"/books/{book_id}/page/1/text-layer", headers=auth_headers).json()
    heat = _heat(client, auth_headers, book_id, target_cefr="B1")
    boxed = {w["i"]: layer["words"][w["i"]]["t"] for w in heat["words"]}
    assert "ubiquitous," in boxed.values()


def test_the_simpler_word_rides_along(client, auth_headers, pdf_book):
    """The tooltip offers it, so it has to be here rather than a second call."""
    book_id, _ = pdf_book
    heat = _heat(client, auth_headers, book_id, target_cefr="B1")
    by_word = {w["word"]: w for w in heat["words"]}
    assert by_word["ubiquitous"]["simpler"] == "everywhere"
    assert by_word["ubiquitous"]["cefr"] == "C1"


def test_a_higher_target_leaves_less_tinted(client, auth_headers, pdf_book):
    """The same page tints differently per reader, which is the whole point."""
    book_id, _ = pdf_book
    b1 = _heat(client, auth_headers, book_id, target_cefr="B1")
    c1 = _heat(client, auth_headers, book_id, target_cefr="C1")
    assert [w["word"] for w in b1["words"]] == ["ubiquitous", "comprehensive"]
    assert [w["word"] for w in c1["words"]] == []


def test_the_readers_own_level_is_used_when_none_is_asked_for(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers, cefr="C1")
    source = tmp_path / "Own.pdf"
    _write_pdf(source, ["The water is ubiquitous, and comprehensive."])
    book_id = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    ).json()[0]["id"]

    heat = _heat(client, auth_headers, book_id, user_id=user_id)
    assert heat["target_cefr"] == "C1"
    assert heat["words"] == []


def test_a_book_with_the_overlay_off_says_so(client, auth_headers, pdf_book):
    """Disabled is not the same as "nothing is hard here", and the client
    shows a different thing for each."""
    book_id, _ = pdf_book
    assert client.patch(
        f"/books/{book_id}", headers=auth_headers, json={"heat_overlay": False}
    ).status_code == 200
    heat = _heat(client, auth_headers, book_id, target_cefr="B1")
    assert heat["enabled"] is False
    assert heat["words"] == []


def test_a_nonsense_target_is_rejected(client, auth_headers, pdf_book):
    book_id, _ = pdf_book
    res = client.get(
        f"/books/{book_id}/page/1/heat", headers=auth_headers, params={"target_cefr": "Z9"}
    )
    assert res.status_code == 400


def test_a_missing_book_is_a_404(client, auth_headers):
    res = client.get("/books/nope/page/1/heat", headers=auth_headers)
    assert res.status_code == 404
