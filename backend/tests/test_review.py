"""The review queue, and the rule that makes this app's argument.

Spec §6.3: "A card can only reach mastery level 5 if it has at least three
spontaneous events across different sessions — recognition alone can never
mark a word mastered. This rule is the formal expression of the project's
thesis." If one test file in this repo has to be right, it is this one.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import fsrs, review
from app.services.fsrs import AGAIN, EASY, GOOD, HARD, Card

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _conn(tmp_path, name="review.db"):
    settings.db_path = str(tmp_path / name)
    conn = get_connection()
    run_migrations(conn)
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) "
        "VALUES ('u1', 'T', 'en', 'en', '2026-01-01T00:00:00Z')"
    )
    conn.execute("INSERT INTO user_settings (user_id) VALUES ('u1')")
    conn.commit()
    return conn


def _word(conn, word="mitigate", *, wid=None, definition="Make less severe.", example=None, ipa=None, audio=None):
    wid = wid or f"w-{word}"
    conn.execute(
        "INSERT INTO vocab_words (id, user_id, word, lemma, pos, cefr, definition, example, "
        "synonyms, ipa, audio_url, created_at) "
        "VALUES (?, 'u1', ?, ?, 'verb', 'B2', ?, ?, '[]', ?, ?, '2026-01-01T00:00:00Z')",
        (wid, word, word.lower(), definition, example, ipa, audio),
    )
    review.ensure_card(conn, "u1", wid)
    conn.commit()
    return wid


# --- the thesis -------------------------------------------------------------


def test_flashcards_alone_can_never_master_a_word():
    """The ceiling that makes the project's claim testable. However stable a
    card becomes through recognition, it stops at level 2 until the learner
    has actually produced the word in conversation."""
    enormous = Card(stability=9999, difficulty=1.0, reps=500, state="review")
    assert review.mastery_for(enormous, 0).level == 2


def test_mastery_needs_three_separate_conversations():
    strong = Card(stability=120, difficulty=2.0, reps=40, state="review")
    assert review.mastery_for(strong, 1).level == 3
    assert review.mastery_for(strong, 2).level == 4
    assert review.mastery_for(strong, 3).level == 5


def test_conversation_alone_does_not_master_an_unstable_card():
    """Production matters, but so does retention over time — three
    spontaneous uses of a word that keeps being forgotten is not mastery."""
    shaky = Card(stability=3, difficulty=8.0, reps=5, state="review")
    assert review.mastery_for(shaky, 5).level == 1


def test_an_unreviewed_card_is_level_zero():
    assert review.mastery_for(Card(), 0).level == 0
    assert review.mastery_for(Card(), 3).level == 0


def test_spontaneous_uses_in_one_session_count_once(tmp_path):
    """Saying a word three times in one conversation is one piece of evidence
    about recall, not three — otherwise a single chatty session fakes mastery."""
    conn = _conn(tmp_path)
    wid = _word(conn)
    conn.execute(
        "INSERT INTO conversation_sessions (id, user_id, scenario, channel, target_word_ids, started_at) "
        "VALUES ('s1', 'u1', 'free', 'text', '[]', '2026-01-01T00:00:00Z')"
    )
    for i in range(3):
        conn.execute(
            "INSERT INTO review_logs (id, user_id, vocab_word_id, session_id, source, outcome, created_at) "
            "VALUES (?, 'u1', ?, 's1', 'conversation', 'spontaneous', '2026-01-01T00:00:00Z')",
            (f"l{i}", wid),
        )
    conn.commit()
    assert review.spontaneous_sessions(conn, wid) == 1


# --- conversation routing (§6.3) --------------------------------------------


def test_conversation_outcomes_map_to_the_spec_ratings():
    assert review.CONVERSATION_RATINGS == {
        "spontaneous": EASY,
        "prompted": GOOD,
        "incorrect": AGAIN,
        "avoided": HARD,
    }


def test_using_a_word_in_conversation_schedules_it(tmp_path):
    """The mechanism the whole project rests on: conversation must move the
    same card a flashcard would, not merely be recorded next to it."""
    conn = _conn(tmp_path)
    wid = _word(conn)
    conn.execute(
        "INSERT INTO conversation_sessions (id, user_id, scenario, channel, target_word_ids, started_at) "
        "VALUES ('s1', 'u1', 'free', 'text', '[]', '2026-01-01T00:00:00Z')"
    )
    conn.commit()

    before = conn.execute("SELECT * FROM review_cards WHERE vocab_word_id = ?", (wid,)).fetchone()
    assert before["state"] == "new" and before["reps"] == 0

    review.apply_conversation_outcomes(conn, "u1", "s1", [(wid, "spontaneous")], now=T0)
    conn.commit()

    after = conn.execute("SELECT * FROM review_cards WHERE vocab_word_id = ?", (wid,)).fetchone()
    assert after["reps"] == 1
    assert after["state"] == "review"
    assert after["due"] is not None
    assert after["stability"] > 0

    log = conn.execute("SELECT * FROM review_logs WHERE vocab_word_id = ?", (wid,)).fetchone()
    assert log["source"] == "conversation"
    assert log["outcome"] == "spontaneous"
    assert log["rating"] == EASY


def test_using_a_word_well_schedules_it_further_out_than_using_it_badly(tmp_path):
    conn = _conn(tmp_path)
    good_id = _word(conn, "alpha", wid="w-good")
    bad_id = _word(conn, "beta", wid="w-bad")
    conn.execute(
        "INSERT INTO conversation_sessions (id, user_id, scenario, channel, target_word_ids, started_at) "
        "VALUES ('s1', 'u1', 'free', 'text', '[]', '2026-01-01T00:00:00Z')"
    )
    conn.commit()

    review.apply_conversation_outcomes(
        conn, "u1", "s1", [(good_id, "spontaneous"), (bad_id, "incorrect")], now=T0
    )
    conn.commit()
    rows = {r["vocab_word_id"]: r for r in conn.execute("SELECT * FROM review_cards")}
    assert rows[good_id]["due"] > rows[bad_id]["due"]


def test_an_unknown_outcome_is_ignored_rather_than_guessed(tmp_path):
    conn = _conn(tmp_path)
    wid = _word(conn)
    conn.commit()
    assert review.apply_conversation_outcomes(conn, "u1", None, [(wid, "mumbled")]) == []
    assert conn.execute("SELECT reps FROM review_cards WHERE vocab_word_id = ?", (wid,)).fetchone()["reps"] == 0


# --- flashcards -------------------------------------------------------------


def test_answering_a_card_advances_it_and_logs_the_source(tmp_path):
    conn = _conn(tmp_path)
    wid = _word(conn)
    result = review.answer_card(conn, "u1", wid, GOOD, now=T0)
    conn.commit()
    assert result["reps"] == 1
    assert result["state"] == "review"
    log = conn.execute("SELECT * FROM review_logs WHERE vocab_word_id = ?", (wid,)).fetchone()
    assert log["source"] == "flashcard"
    assert log["outcome"] == "good"
    assert log["rating"] == GOOD


def test_a_word_belonging_to_someone_else_cannot_be_rated(tmp_path):
    conn = _conn(tmp_path)
    wid = _word(conn)
    with pytest.raises(LookupError):
        review.answer_card(conn, "someone-else", wid, GOOD)


def test_an_out_of_range_rating_is_refused(tmp_path):
    conn = _conn(tmp_path)
    wid = _word(conn)
    for bad in (0, 5):
        with pytest.raises(ValueError):
            review.answer_card(conn, "u1", wid, bad)


def test_a_leech_is_suspended_out_of_the_queue(tmp_path):
    """Spec §5.5: eight lapses means the card is not working as posed. It
    should stop consuming sittings rather than keep failing."""
    conn = _conn(tmp_path)
    wid = _word(conn)
    now = T0
    review.answer_card(conn, "u1", wid, GOOD, now=now)
    for _ in range(fsrs.LEECH_THRESHOLD + 2):
        row = conn.execute("SELECT * FROM review_cards WHERE vocab_word_id = ?", (wid,)).fetchone()
        now = review._parse(row["due"])
        review.answer_card(conn, "u1", wid, GOOD, now=now)
        row = conn.execute("SELECT * FROM review_cards WHERE vocab_word_id = ?", (wid,)).fetchone()
        review.answer_card(conn, "u1", wid, AGAIN, now=review._parse(row["due"]))
    conn.commit()

    card = conn.execute("SELECT * FROM review_cards WHERE vocab_word_id = ?", (wid,)).fetchone()
    assert card["lapses"] >= fsrs.LEECH_THRESHOLD
    assert card["suspended"] == 1
    assert review.build_queue(conn, "u1", now=now + timedelta(days=365)) == []
    # Its schedule survives, so unsuspending resumes rather than restarts.
    assert card["reps"] > 0 and card["stability"] > 0


# --- the queue --------------------------------------------------------------


def test_new_cards_are_capped_per_session(tmp_path):
    """Spec §5.5 load smoothing: new cards create tomorrow's workload, so a
    big import must not become an unmanageable backlog next week."""
    conn = _conn(tmp_path)
    for i in range(30):
        _word(conn, f"word{i}", wid=f"w{i}")
    conn.commit()
    queue = review.build_queue(conn, "u1", limit=20, new_limit=5, now=T0)
    assert len(queue) == 5
    assert all(c["state"] == "new" for c in queue)


def test_due_cards_come_before_new_ones(tmp_path):
    """An overdue card is being forgotten right now; a new one is merely
    unlearned. Introducing new material first is how backlogs stick."""
    conn = _conn(tmp_path)
    due_id = _word(conn, "due", wid="w-due")
    _word(conn, "fresh", wid="w-fresh")
    review.answer_card(conn, "u1", due_id, GOOD, now=T0)
    conn.commit()

    later = T0 + timedelta(days=400)
    queue = review.build_queue(conn, "u1", now=later)
    assert queue[0]["vocab_word_id"] == due_id


def test_a_card_that_is_not_due_stays_out_of_the_queue(tmp_path):
    conn = _conn(tmp_path)
    wid = _word(conn)
    review.answer_card(conn, "u1", wid, EASY, now=T0)
    conn.commit()
    assert review.build_queue(conn, "u1", now=T0 + timedelta(hours=1)) == []


def test_card_types_are_interleaved(tmp_path):
    """Spec §5.5: mixing types measurably improves retention over grouping."""
    conn = _conn(tmp_path)
    for i in range(8):
        _word(conn, f"word{i}", wid=f"w{i}", example=f"A sentence with word{i} inside.", audio="/a.wav")
    conn.commit()
    types = [c["card_type"] for c in review.build_queue(conn, "u1", new_limit=8, now=T0)]
    assert len(set(types)) > 1, f"queue was not interleaved: {types}"


def test_a_cloze_is_only_offered_when_the_word_is_really_in_the_sentence(tmp_path):
    """A blank that hides nothing teaches nothing — so a cloze whose sentence
    doesn't contain the word must fall back rather than render an empty gap."""
    conn = _conn(tmp_path)
    _word(conn, "mitigate", wid="w-ok", example="We must mitigate the risk.")
    _word(conn, "stark", wid="w-bad", example="An unrelated sentence entirely.")
    conn.commit()
    by_id = {c["vocab_word_id"]: c for c in review.build_queue(conn, "u1", new_limit=8, now=T0)}
    for card in by_id.values():
        if card["card_type"] == "cloze":
            joined = f"{card['cloze_before']} {card['cloze_after']}"
            assert card["word"].lower() not in joined.lower()
            assert card["cloze_before"] is not None


def test_listening_cards_are_not_offered_without_audio(tmp_path):
    conn = _conn(tmp_path)
    for i in range(8):
        _word(conn, f"word{i}", wid=f"w{i}")
    conn.commit()
    assert all(c["card_type"] != "listening" for c in review.build_queue(conn, "u1", new_limit=8, now=T0))


def test_every_card_shows_what_each_button_would_schedule(tmp_path):
    """A scheduler whose consequences are invisible is one nobody calibrates
    their answers against."""
    conn = _conn(tmp_path)
    _word(conn)
    conn.commit()
    card = review.build_queue(conn, "u1", now=T0)[0]
    assert set(card["intervals"]) == {"again", "hard", "good", "easy"}
    assert all(isinstance(v, str) and v for v in card["intervals"].values())


# --- stats ------------------------------------------------------------------


def test_stats_report_real_counts(tmp_path):
    conn = _conn(tmp_path)
    for i in range(6):
        _word(conn, f"word{i}", wid=f"w{i}")
    review.answer_card(conn, "u1", "w0", GOOD, now=T0)
    conn.commit()

    later = T0 + timedelta(days=400)
    s = review.stats(conn, "u1", now=later)
    assert s["total_cards"] == 6
    assert s["new_available"] == 5
    assert s["due_now"] == 1
    assert len(s["forecast"]) == 30
    assert sum(s["mastery_counts"]) == 6


def test_due_count_ignores_suspended_and_new(tmp_path):
    conn = _conn(tmp_path)
    a = _word(conn, "a", wid="wa")
    _word(conn, "b", wid="wb")
    review.answer_card(conn, "u1", a, GOOD, now=T0)
    conn.commit()
    later = T0 + timedelta(days=400)
    assert review.due_count(conn, "u1", now=later) == 1
    review.set_suspended(conn, "u1", a, True)
    conn.commit()
    assert review.due_count(conn, "u1", now=later) == 0


# --- routes -----------------------------------------------------------------

def _create_user(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "R", "native_language": "en", "target_language": "en", "data_folder": "~/FluencyOS"},
    )
    assert res.status_code == 201
    return res.json()["id"]


def _save_word(client, auth_headers, user_id, word):
    """The manual path, so these tests don't depend on the bundled lexicon
    containing any particular word."""
    return client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "word": word,
            "pos": "verb",
            "definition": "Make less severe.",
            "example": f"We must {word} the risk.",
            "synonyms": [],
        },
    )


def test_review_routes_require_a_token(client):
    assert client.get("/review/queue", params={"user_id": "u1"}).status_code == 401
    assert client.get("/review/stats", params={"user_id": "u1"}).status_code == 401


def test_stats_are_empty_for_a_new_user(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    body = client.get("/review/stats", headers=auth_headers, params={"user_id": user_id}).json()
    assert body["total_cards"] == 0
    assert body["due_now"] == 0
    assert len(body["forecast"]) == 30
    # The nav badge reads this. It used to be the hardcoded string "47".
    assert body["mastery_counts"] == [0, 0, 0, 0, 0, 0]


def test_saving_a_word_puts_it_in_the_queue(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    assert _save_word(client, auth_headers, user_id, "mitigate").status_code < 400

    queue = client.get("/review/queue", headers=auth_headers, params={"user_id": user_id}).json()
    assert len(queue) == 1
    card = queue[0]
    assert card["word"].lower() == "mitigate"
    assert card["state"] == "new"
    assert set(card["intervals"]) == {"again", "hard", "good", "easy"}


def test_rating_a_card_schedules_it_and_it_leaves_the_queue(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    assert _save_word(client, auth_headers, user_id, "mitigate").status_code < 400
    word_id = client.get("/review/queue", headers=auth_headers, params={"user_id": user_id}).json()[0][
        "vocab_word_id"
    ]

    res = client.post(
        f"/review/cards/{word_id}/rate", headers=auth_headers, json={"user_id": user_id, "rating": 3}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["reps"] == 1
    assert body["state"] == "review"
    assert body["interval_label"]

    # Answered cards are not due again today.
    assert client.get("/review/queue", headers=auth_headers, params={"user_id": user_id}).json() == []


def test_an_invalid_rating_is_rejected_by_the_api(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/review/cards/whatever/rate", headers=auth_headers, json={"user_id": user_id, "rating": 9}
    )
    assert res.status_code == 422


def test_rating_someone_elses_card_is_a_404(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/review/cards/not-mine/rate", headers=auth_headers, json={"user_id": user_id, "rating": 3}
    )
    assert res.status_code == 404


# --- the clip a word was met in --------------------------------------------
#
# A word saved from a film carries the moment it was said. The review card
# quoted that line as text and left the video unused, which is the one thing
# this app captures that a paper flashcard cannot.


def _film(conn, item_id="m1", title="Arrival (2016)"):
    conn.execute(
        "INSERT INTO media_items (id, user_id, title, kind, source_path, file_hash, duration_ms,"
        " added_at) VALUES (?, 'u1', ?, 'local', '/tmp/a.mkv', ?, 600000, '2026-01-01T00:00:00Z')",
        (item_id, title, item_id),
    )


def _context(conn, wid, *, cid, kind, snippet, at, media_item_id=None, clip_status=None):
    conn.execute(
        "INSERT INTO vocab_contexts (id, vocab_word_id, kind, snippet, source_label,"
        " media_item_id, created_at) VALUES (?, ?, ?, ?, 'src', ?, ?)",
        (cid, wid, kind, snippet, media_item_id, at),
    )
    if clip_status is not None:
        conn.execute(
            "INSERT INTO media_clips (id, media_item_id, vocab_word_id, vocab_context_id,"
            " cue_text, start_ms, end_ms, status, created_at)"
            " VALUES (?, ?, ?, ?, ?, 1000, 4000, ?, ?)",
            (f"clip-{cid}", media_item_id, wid, cid, snippet, clip_status, at),
        )
    conn.commit()


def _card(conn, wid):
    queue = review.build_queue(conn, "u1", limit=20, new_limit=20, now=T0)
    return next(c for c in queue if c["vocab_word_id"] == wid)


def test_a_word_saved_from_a_film_carries_its_clip(tmp_path):
    conn = _conn(tmp_path)
    _film(conn)
    wid = _word(conn, "mitigate")
    _context(
        conn, wid, cid="c1", kind="clip", snippet="We can mitigate it.",
        at="2026-01-02T00:00:00Z", media_item_id="m1", clip_status="ready",
    )
    card = _card(conn, wid)
    assert card["clip_id"] == "clip-c1"
    assert card["clip_status"] == "ready"
    assert card["media_item_id"] == "m1"
    assert card["context_snippet"] == "We can mitigate it."


def test_a_word_with_no_clip_says_so_rather_than_guessing(tmp_path):
    conn = _conn(tmp_path)
    wid = _word(conn, "mitigate")
    _context(conn, wid, cid="c1", kind="page", snippet="From a book.", at="2026-01-02T00:00:00Z")
    card = _card(conn, wid)
    assert card["clip_id"] is None
    assert card["clip_status"] is None
    assert card["context_snippet"] == "From a book."


def test_the_clip_wins_over_a_more_recent_page(tmp_path):
    """Preference, not recency. The moment from a film is the richer context,
    and a word met again in a book should not hide it."""
    conn = _conn(tmp_path)
    _film(conn)
    wid = _word(conn, "mitigate")
    _context(
        conn, wid, cid="c-clip", kind="clip", snippet="Said in the film.",
        at="2026-01-02T00:00:00Z", media_item_id="m1", clip_status="ready",
    )
    _context(conn, wid, cid="c-page", kind="page", snippet="Read in a book.", at="2026-06-01T00:00:00Z")
    card = _card(conn, wid)
    assert card["clip_id"] == "clip-c-clip"
    # The line quoted and the clip played must come from the same context, or
    # the card shows one sentence and plays another.
    assert card["context_snippet"] == "Said in the film."


def test_the_newest_still_wins_among_contexts_that_are_alike(tmp_path):
    conn = _conn(tmp_path)
    wid = _word(conn, "mitigate")
    _context(conn, wid, cid="c-old", kind="page", snippet="Older.", at="2026-01-02T00:00:00Z")
    _context(conn, wid, cid="c-new", kind="page", snippet="Newer.", at="2026-06-01T00:00:00Z")
    assert _card(conn, wid)["context_snippet"] == "Newer."


def test_a_clip_still_being_cut_is_reported_as_such(tmp_path):
    """Queued, extracting and failed are all real states. The card needs to
    distinguish them so it never offers a play button that does nothing."""
    conn = _conn(tmp_path)
    _film(conn)
    wid = _word(conn, "mitigate")
    _context(
        conn, wid, cid="c1", kind="clip", snippet="Not cut yet.",
        at="2026-01-02T00:00:00Z", media_item_id="m1", clip_status="queued",
    )
    card = _card(conn, wid)
    assert card["clip_status"] == "queued"
    assert card["clip_id"] is not None


def test_a_clip_whose_film_was_removed_reports_no_media_item(tmp_path):
    """The line and the timecode are still the learner's; the video is not.
    media_item_id going null is what tells the card to say so."""
    conn = _conn(tmp_path)
    _film(conn)
    wid = _word(conn, "mitigate")
    _context(
        conn, wid, cid="c1", kind="clip", snippet="From a film since removed.",
        at="2026-01-02T00:00:00Z", media_item_id="m1", clip_status="ready",
    )
    conn.execute("DELETE FROM media_items WHERE id = 'm1'")
    conn.commit()

    card = _card(conn, wid)
    assert card["media_item_id"] is None
    assert card["context_snippet"] == "From a film since removed."
