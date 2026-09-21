"""Editing who you are after onboarding: name, languages, level and the
profile picture."""

from pathlib import Path


def _png(path: Path) -> Path:
    """A real 1x1 PNG, so the copy path is exercised on actual bytes."""
    path.write_bytes(
        bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
            "890000000a49444154789c6360000002000100ffff03000006000557bfabd400"
            "00000049454e44ae426082"
        )
    )
    return path


def _user(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={
            "display_name": "Foyez",
            "native_language": "bn",
            "target_language": "en",
            "data_folder": "~/FluencyOS",
        },
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_a_display_name_can_be_corrected(client, auth_headers):
    user_id = _user(client, auth_headers)
    res = client.patch(
        f"/users/{user_id}", headers=auth_headers, json={"display_name": "  Foyez Ahmed  "}
    )
    assert res.status_code == 200, res.text
    assert res.json()["display_name"] == "Foyez Ahmed"


def test_one_field_at_a_time_leaves_the_others_alone(client, auth_headers):
    """The settings screen saves a row at a time; a patch that insisted on
    every field would overwrite a language while fixing a name."""
    user_id = _user(client, auth_headers)
    client.patch(f"/users/{user_id}", headers=auth_headers, json={"native_language": "hi"})
    after = client.patch(
        f"/users/{user_id}", headers=auth_headers, json={"display_name": "Someone"}
    ).json()
    assert after["native_language"] == "hi"
    assert after["target_language"] == "en"
    assert after["display_name"] == "Someone"


def test_an_empty_display_name_is_refused(client, auth_headers):
    user_id = _user(client, auth_headers)
    res = client.patch(f"/users/{user_id}", headers=auth_headers, json={"display_name": "   "})
    assert res.status_code == 400


def test_the_level_can_be_changed_here_too(client, auth_headers):
    user_id = _user(client, auth_headers)
    res = client.patch(f"/users/{user_id}", headers=auth_headers, json={"cefr_level": "B2"})
    assert res.json()["cefr_level"] == "B2"


def test_a_picture_is_copied_in_and_then_served(client, auth_headers, tmp_path):
    """Copied, not referenced: a picture left in the folder it was picked from
    disappears the day that folder is tidied."""
    user_id = _user(client, auth_headers)
    source = _png(tmp_path / "me.png")

    res = client.put(f"/users/{user_id}/avatar", headers=auth_headers, json={"path": str(source)})
    assert res.status_code == 200, res.text
    assert res.json()["has_avatar"] is True

    served = client.get(f"/users/{user_id}/avatar", headers=auth_headers)
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/png"
    assert served.content == source.read_bytes()

    # The original going away must not take the profile picture with it.
    source.unlink()
    assert client.get(f"/users/{user_id}/avatar", headers=auth_headers).status_code == 200


def test_the_browser_can_fetch_the_picture_without_a_header(client, auth_headers, tmp_path):
    """An <img src> cannot carry a custom header, so the picture takes the
    handshake token in the query string like video and thumbnails do.

    The first version of this feature did not: the picture saved correctly and
    then failed to load every time, which looks like a broken image and reads
    like a broken feature. Tests that sent the header all passed while the app
    showed nothing.
    """
    user_id = _user(client, auth_headers)
    client.put(
        f"/users/{user_id}/avatar", headers=auth_headers, json={"path": str(_png(tmp_path / "me.png"))}
    )

    as_the_browser_asks = client.get(f"/users/{user_id}/avatar", params={"t": "test-token"})
    assert as_the_browser_asks.status_code == 200, as_the_browser_asks.text
    assert as_the_browser_asks.headers["content-type"] == "image/png"


def test_the_picture_still_needs_the_token(client, auth_headers, tmp_path):
    user_id = _user(client, auth_headers)
    client.put(
        f"/users/{user_id}/avatar", headers=auth_headers, json={"path": str(_png(tmp_path / "me.png"))}
    )
    assert client.get(f"/users/{user_id}/avatar").status_code == 401
    assert client.get(f"/users/{user_id}/avatar", params={"t": "wrong"}).status_code == 401


def test_no_picture_set_says_so_rather_than_serving_something_else(client, auth_headers):
    user_id = _user(client, auth_headers)
    assert client.get(f"/users/{user_id}", headers=auth_headers).json()["has_avatar"] is False
    assert client.get(f"/users/{user_id}/avatar", headers=auth_headers).status_code == 404


def test_a_picture_can_be_removed(client, auth_headers, tmp_path):
    user_id = _user(client, auth_headers)
    client.put(
        f"/users/{user_id}/avatar", headers=auth_headers, json={"path": str(_png(tmp_path / "a.png"))}
    )
    res = client.delete(f"/users/{user_id}/avatar", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["has_avatar"] is False
    assert client.get(f"/users/{user_id}/avatar", headers=auth_headers).status_code == 404


def test_something_that_is_not_a_picture_is_refused(client, auth_headers, tmp_path):
    user_id = _user(client, auth_headers)
    doc = tmp_path / "notes.txt"
    doc.write_text("not a picture", encoding="utf-8")
    res = client.put(f"/users/{user_id}/avatar", headers=auth_headers, json={"path": str(doc)})
    assert res.status_code == 400
    assert "png" in res.json()["detail"]


def test_a_file_that_is_not_there_is_refused(client, auth_headers, tmp_path):
    user_id = _user(client, auth_headers)
    res = client.put(
        f"/users/{user_id}/avatar", headers=auth_headers, json={"path": str(tmp_path / "gone.png")}
    )
    assert res.status_code == 404


def test_replacing_a_picture_does_not_leave_the_old_one_behind(client, auth_headers, tmp_path):
    user_id = _user(client, auth_headers)
    client.put(f"/users/{user_id}/avatar", headers=auth_headers, json={"path": str(_png(tmp_path / "first.png"))})
    from app.services import book_storage

    before = list(book_storage.avatars_dir().glob(f"{user_id}.*"))
    assert len(before) == 1

    second = tmp_path / "second.jpg"
    second.write_bytes(_png(tmp_path / "src.png").read_bytes())
    client.put(f"/users/{user_id}/avatar", headers=auth_headers, json={"path": str(second)})
    after = list(book_storage.avatars_dir().glob(f"{user_id}.*"))
    assert len(after) == 1, [p.name for p in after]
    assert after[0].suffix == ".jpg"


def test_editing_someone_who_does_not_exist_is_a_404(client, auth_headers):
    assert client.patch("/users/nope", headers=auth_headers, json={"display_name": "x"}).status_code == 404
