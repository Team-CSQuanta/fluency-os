"""Conversation scenes: the catalog, the prompt each runs on, and the
learner's own scenes."""

import json

import pytest

from app.services import conversation, scenarios
from tests.test_conversation import _fresh_conn, _make_user, _save_word, fake_llm  # noqa: F401


@pytest.mark.parametrize("scene", scenarios.SCENARIOS, ids=lambda s: s.key)
def test_every_scene_builds_a_complete_prompt(scene):
    prompt = scenarios.build_system_prompt(scene, level="B1", target_words=[("reticent", "not revealing much")])
    # The character, the scene, the rules that make it practice.
    assert scene.persona.name in prompt
    assert scene.goal in prompt
    assert all(step in prompt for step in scene.arc)
    assert "Recast" in prompt and "Never say a target word" in prompt
    assert "reticent: not revealing much" in prompt
    # Nothing left unfilled.
    assert "{" not in prompt and "}" not in prompt


def test_every_scene_is_in_a_category_the_picker_shows():
    shown = {s["key"] for c in scenarios.catalog() for s in c["scenarios"]}
    assert shown == set(scenarios.BY_KEY)
    assert len(scenarios.SCENARIOS) == len(scenarios.BY_KEY), "two scenes share a key"


def test_the_partner_speaks_at_the_learners_level():
    coffee = scenarios.BY_KEY["coffee"]
    a1 = scenarios.build_system_prompt(coffee, level="a1", target_words=[])
    c1 = scenarios.build_system_prompt(coffee, level="C1", target_words=[])
    assert "level A1" in a1 and "Avoid idioms" in a1
    assert "level C1" in c1 and "idiomatic" in c1
    # An unknown level falls back rather than breaking the prompt.
    assert "level B1" in scenarios.build_system_prompt(coffee, level="Z9", target_words=[])


def test_an_unknown_scene_from_an_old_session_falls_back_to_free_talk():
    assert scenarios.resolve("no-longer-exists").key == "free"


def test_a_session_opens_in_its_scene_at_the_learners_level(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    conn.execute("UPDATE users SET cefr_level = 'A2' WHERE id = ?", (user_id,))
    _save_word(conn, user_id, "reticent")

    conversation.start_session(conn, user_id=user_id, scenario="hotel", channel="text")

    system_prompt, history = fake_llm["replies"][0]
    assert "You are Olivia" in system_prompt
    assert "level A2" in system_prompt
    # The opening asks for this scene's first line, not a generic greeting.
    assert scenarios.BY_KEY["hotel"].opening in history[0][1]


def test_an_unknown_scene_is_refused_when_starting(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    with pytest.raises(ValueError):
        conversation.start_session(conn, user_id=user_id, scenario="bogus", channel="text")


def test_a_learners_own_scene_runs_and_outlives_its_deletion(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    custom = conversation.create_custom_scenario(
        conn,
        user_id,
        {
            "title": "Renting a flat",
            "ai_name": "Mr. Okafor",
            "ai_role": "a landlord showing a flat",
            "setting": "A small one-bedroom flat for rent near the station.",
            "learner_role": "someone looking for a flat",
            "goal": "Ask about rent, bills and the contract, and decide.",
        },
    )

    first = conversation.start_session(
        conn, user_id=user_id, scenario="custom", channel="text", custom_scenario_id=custom["id"]
    )
    system_prompt, _ = fake_llm["replies"][0]
    assert "You are Mr. Okafor, a landlord showing a flat" in system_prompt
    assert "one-bedroom flat" in system_prompt
    session = conversation.get_session_row(conn, first, user_id)
    assert conversation.scenario_label(session) == "Renting a flat"

    # Deleted, the scene is still there for the session that used it, and
    # "practise again" still runs it.
    assert conversation.delete_custom_scenario(conn, user_id, custom["id"])
    again = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text", repeat_of=first)
    assert conversation.scenario_label(conversation.get_session_row(conn, again, user_id)) == "Renting a flat"
    assert "Mr. Okafor" in fake_llm["replies"][-1][0]


def test_a_scene_needs_a_title_a_role_and_a_situation(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    with pytest.raises(ValueError):
        conversation.create_custom_scenario(conn, user_id, {"title": "Empty", "ai_role": "", "setting": ""})


def test_the_catalog_route_lists_categories_and_the_learners_scenes(client, auth_headers):
    from tests.test_conversation import _create_user

    user_id = _create_user(client, auth_headers)
    made = client.post(
        "/conversation/custom-scenarios",
        headers=auth_headers,
        json={"user_id": user_id, "title": "At the bank", "ai_role": "a bank clerk", "setting": "Opening an account."},
    )
    assert made.status_code == 201
    body = client.get("/conversation/scenarios", headers=auth_headers, params={"user_id": user_id}).json()
    assert {c["key"] for c in body["categories"]} >= {"everyday", "travel", "work"}
    assert [c["title"] for c in body["custom"]] == ["At the bank"]

    gone = client.delete(
        f"/conversation/custom-scenarios/{made.json()['id']}", headers=auth_headers, params={"user_id": user_id}
    )
    assert gone.status_code == 204


def test_reply_length_and_corrections_shape_the_prompt():
    coffee = scenarios.BY_KEY["coffee"]
    short = scenarios.build_system_prompt(coffee, level="B1", target_words=[], reply_length="short")
    long = scenarios.build_system_prompt(coffee, level="B1", target_words=[], reply_length="long")
    assert "ONE short sentence" in short and "Two to four sentences" in long
    gentle = scenarios.build_system_prompt(coffee, level="B1", target_words=[])
    pointed = scenarios.build_system_prompt(coffee, level="B1", target_words=[], corrections="explicit")
    assert "Recast instead" in gentle and "[fix" not in gentle
    assert '[fix grammar: "I goed" -> "I went" (past of go)]' in pointed and "exception is the [fix …] notes" in pointed
    assert "up to 3 fix(es)" in pointed
    beginner = scenarios.build_system_prompt(coffee, level="A1", target_words=[], corrections="explicit")
    assert "up to 1 fix(es)" in beginner


def test_the_settings_reach_the_partner(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    conn.execute("INSERT INTO user_settings (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING", (user_id,))
    conn.execute(
        "UPDATE user_settings SET conversation_reply_length = 'long', conversation_corrections = 'explicit' "
        "WHERE user_id = ?",
        (user_id,),
    )
    prefs = conversation.reply_prefs(conn, user_id)
    assert prefs == {"reply_length": "long", "corrections": "explicit"}
    assert conversation.reply_tokens(prefs) == scenarios.REPLY_TOKENS["long"] + scenarios.CORRECTION_TOKENS

    conversation.start_session(conn, user_id=user_id, scenario="coffee", channel="text")
    system_prompt, _ = fake_llm["replies"][0]
    assert "Two to four sentences" in system_prompt and "[fix KIND:" in system_prompt


def test_conversation_settings_are_saved_and_checked(client, auth_headers):
    from tests.test_conversation import _create_user

    user_id = _create_user(client, auth_headers)
    patch = {
        "conversation_reply_length": "short",
        "conversation_corrections": "explicit",
        "conversation_voice_speed": 0.9,
        "conversation_hide_text": True,
        "conversation_hands_free": False,
    }
    body = client.patch(f"/users/{user_id}/settings", headers=auth_headers, json=patch).json()
    assert {k: body[k] for k in patch} == patch
    for bad in ({"conversation_voice_speed": 2.0}, {"conversation_reply_length": "essay"}):
        assert client.patch(f"/users/{user_id}/settings", headers=auth_headers, json=bad).status_code == 422


def _fix(wrong, right, kind="grammar", why=None):
    return {"wrong": wrong, "right": right, "kind": kind, "why": why}


@pytest.mark.parametrize(
    "reply, learner, expected",
    [
        # The asked-for form; `wrong` comes back as the learner said it.
        (
            'Why do you think it\'s too high? [fix word: "500 Drummer" -> "500 dollars" (the currency)]',
            "500 drummer, do you know the current market price?",
            [_fix("500 drummer", "500 dollars", "word", "the currency")],
        ),
        # Several at once, each kind, most important first.
        (
            'Nice! [fix grammar: "I goed" -> "I went" (past of go)] '
            '[fix word: "price is expensive" -> "price is high"]',
            "Yesterday I goed to the shop but the price is expensive.",
            [_fix("I goed", "I went", "grammar", "past of go"), _fix("price is expensive", "price is high", "word")],
        ),
        (
            'They aren\'t! [fix sentence: "I think this scratches crass to look severe" -> '
            '"I think these scratches look bad"]',
            "It's fine. Also, I think this scratches, um, crass to look severe.",
            [_fix("I think this scratches, um, crass to look severe", "I think these scratches look bad", "sentence")],
        ),
        # The old forms a model can drift back to, curly quotes and all.
        (
            "Oh, you went there? [Small fix: “I went”, not “I goed”.]",
            "Yesterday I goed there.",
            [_fix("I goed", "I went")],
        ),
        ('Sure! [fix: "she go" -> "she goes"]', "Every day she, go home", [_fix("she, go", "she goes")]),
        # An unknown kind is still a fix.
        ('Ok. [fix spelling: "she go" -> "she goes"]', "she go home", [_fix("she go", "she goes")]),
        # Punctuation only: the transcriber's, not a mistake.
        ('Nice. [fix grammar: "well I" -> "well, I"]', "Well, I think so", []),
        # The two sides swapped: the one the learner said is the mistake.
        (
            'They aren\'t severe! [fix: "these scratches look severe" -> "this scratches, crass, crass to look severe"]',
            "Also, I think this scratches, crass, crass to look severe.",
            [_fix("this scratches, crass, crass to look severe", "these scratches look severe")],
        ),
        # A fix for an earlier message, repeated: not about this one.
        (
            'How about $450? [fix: "this scratches, crass, crass to look severe" -> "these scratches look severe"]',
            "So, I would like to give you, umm, $400 for this drone.",
            [],
        ),
        # Two fixes over the same words: the first, most important, is kept.
        (
            'Ok. [fix sentence: "he go shop yesterday" -> "he went to the shop yesterday"] '
            '[fix grammar: "he go" -> "he went"]',
            "Well he go shop yesterday.",
            [_fix("he go shop yesterday", "he went to the shop yesterday", "sentence")],
        ),
        # Paraphrased: kept as given, for the client to show under the message.
        ('Right. [fix: "he don\'t" -> "he doesn\'t"]', "He do not like it", [_fix("he don't", "he doesn't")]),
    ],
)
def test_the_fix_notes_are_taken_out_of_the_reply(reply, learner, expected):
    clean, fixes = scenarios.split_corrections(reply, learner)
    assert "fix" not in clean.lower() and "[" not in clean
    assert fixes == expected


def test_no_more_fixes_than_the_learner_can_take_in():
    reply = 'Ok. [fix: "a goed" -> "a went"] [fix: "b goed" -> "b went"] [fix: "c goed" -> "c went"] [fix: "d goed" -> "d went"]'
    learner = "a goed b goed c goed d goed"
    assert len(scenarios.split_corrections(reply, learner)[1]) == 3
    assert len(scenarios.split_corrections(reply, learner, scenarios.max_fixes("a2"))[1]) == 1


def test_a_reply_without_a_note_is_left_alone():
    assert scenarios.split_corrections("Market price? Look, it's a great deal.", "500 dollars?") == (
        "Market price? Look, it's a great deal.",
        [],
    )


def test_the_fixes_go_on_the_learners_turn_and_are_never_spoken(tmp_path, fake_llm, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    conn.execute("INSERT INTO user_settings (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING", (user_id,))
    conn.execute("UPDATE user_settings SET conversation_corrections = 'explicit' WHERE user_id = ?", (user_id,))
    session_id = conversation.start_session(conn, user_id=user_id, scenario="coffee", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    monkeypatch.setattr(
        conversation.llm_chat_engine,
        "generate_reply",
        lambda *a, **kw: 'Market price? It\'s a great deal. [fix word: "500 drummer" -> "500 dollars" (money)]',
    )

    user_turn, ai_turn = conversation.submit_user_turn(
        conn, session, text="500 drummer, do you know the price?", audio_bytes=None
    )

    assert ai_turn["text"] == "Market price? It's a great deal."
    assert json.loads(user_turn["correction"]) == [_fix("500 drummer", "500 dollars", "word", "money")]


def test_gentle_mode_keeps_no_fix_even_if_the_model_adds_one(tmp_path, fake_llm, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    session_id = conversation.start_session(conn, user_id=user_id, scenario="coffee", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    monkeypatch.setattr(
        conversation.llm_chat_engine, "generate_reply", lambda *a, **kw: 'You went? [fix: "I goed" -> "I went"]'
    )

    user_turn, ai_turn = conversation.submit_user_turn(conn, session, text="I goed", audio_bytes=None)

    assert ai_turn["text"] == "You went?" and user_turn["correction"] is None


def test_old_notes_are_neither_shown_spoken_nor_fed_back(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    session_id = conversation.start_session(conn, user_id=user_id, scenario="coffee", channel="voice")
    session = conversation.get_session_row(conn, session_id, user_id)
    conn.execute(
        "UPDATE conversation_turns SET text = ? WHERE session_id = ?",
        ('Why is it too high?\n\n[Small fix: "500 dollars", not "500 drummer".]', session_id),
    )
    opening = conversation.get_turns(conn, session_id)[0]
    assert conversation.audio_chunk_texts(opening, "voice") == ["Why is it too high?"]

    conversation.submit_user_turn(conn, session, text="Because it is old", audio_bytes=None)
    system_prompt, history = fake_llm["replies"][-1]
    assert "Small fix" not in system_prompt + str(history)


def test_stored_fixes_are_placed_again_when_shown():
    # Saved before the checks above, one to a turn: one backwards, one about
    # an earlier message.
    backwards = {"wrong": "these scratches look severe", "right": "this scratches, crass, crass to look severe"}
    assert scenarios.place_corrections(
        [backwards], "Also, I think this scratches, crass, crass to look severe."
    ) == [_fix("this scratches, crass, crass to look severe", "these scratches look severe")]
    carried_over = {"wrong": "this scratches, crass, crass to look severe", "right": "these scratches look severe"}
    assert scenarios.place_corrections([carried_over], "So, I would like to give you, umm, $400 for this drone.") == []
