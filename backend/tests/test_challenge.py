"""Scene Description Challenge (spec §6.4).

The scoring rubric is the thing worth pinning: two of its four parts are
arithmetic over the transcript and must be exactly right, and the round must
not hand the learner the answer before they have attempted it.
"""

import json
import sqlite3

import pytest

from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import challenge, scene_vocabulary, vocabulary_ai
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now


def _seed_scenes(c: sqlite3.Connection, count: int = 60) -> None:
    """A handful of stand-in scenes, with the import marked done.

    The real corpus is 34,991 rows and about 30 MB in the database. Importing
    it per test would be 30 MB of temp disk each and seconds of setup for
    tests that only need "a scene exists" — the two tests that actually check
    the import do it for real, on their own connection.
    """
    bands = ("A1", "A2", "B1", "B2")
    c.executemany(
        "INSERT INTO vatex_scenes (video_id, start_s, end_s, cefr, captions) VALUES (?, ?, ?, ?, ?)",
        [
            (
                f"vid{i:08d}",
                i,
                i + 10,
                bands[i % len(bands)],
                json.dumps([f"Someone does thing {i} number {n}." for n in range(10)]),
            )
            for i in range(count)
        ],
    )
    c.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('vatex_scenes_imported', ?)",
        (iso8601_utc_now(),),
    )


@pytest.fixture()
def conn(tmp_path) -> sqlite3.Connection:
    c = get_connection(str(tmp_path / "ch.db"))
    run_migrations(c)
    _seed_scenes(c)
    c.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, cefr_level, created_at) "
        "VALUES ('u1','L','bn','en','B1',?)",
        (iso8601_utc_now(),),
    )
    c.execute(
        "INSERT INTO media_items (id, user_id, title, kind, source_path, file_hash, duration_ms, added_at) "
        "VALUES ('m1','u1','Arrival (2016)','local','/tmp/a.mkv','h1',600000,?)",
        (iso8601_utc_now(),),
    )
    c.commit()
    yield c
    c.close()


def _word(conn, word, *, due=None):
    wid = uuid7()
    conn.execute(
        "INSERT INTO vocab_words (id, user_id, word, lemma, pos, definition, created_at) "
        "VALUES (?, 'u1', ?, ?, 'verb', 'd', ?)",
        (wid, word, word, iso8601_utc_now()),
    )
    # A realistic review card: a state of 'review' with no stability is an
    # inconsistent row the app never writes.
    conn.execute(
        "INSERT INTO review_cards (vocab_word_id, user_id, state, stability, difficulty, reps, due, created_at) "
        "VALUES (?, 'u1', 'review', 12.0, 5.0, 3, ?, ?)",
        (wid, due, iso8601_utc_now()),
    )
    return wid


# --------------------------------------------------------------------------
# scoring arithmetic


@pytest.mark.parametrize(
    "seconds,expected",
    [(None, 0.0), (0, 0.0), (22.5, 0.5), (45, 1.0), (90, 1.0)],
)
def test_duration_score(seconds, expected):
    assert challenge.duration_score(seconds) == pytest.approx(expected, abs=0.01)


def test_the_speaking_target_follows_the_clip():
    """Every VATEX scene is 10 seconds and the library clips are 1-10, so a
    fixed 45-second target asked for four times more speech than there was
    video. It is proportional now, with a floor and the spec's figure as a
    ceiling."""
    assert challenge.duration_target(10) == 20
    assert challenge.duration_target(1) == challenge.TARGET_SECONDS_MIN
    assert challenge.duration_target(600) == challenge.TARGET_SECONDS_MAX


def test_matching_the_reference_descriptions_is_not_scored_as_silence():
    """The ten references have a median of 14 words — about 6 seconds spoken.
    Against the old fixed 45-second target that earned 0.13, so describing a
    clip exactly as well as ten humans did was marked as barely speaking."""
    target = challenge.duration_target(10)
    like_the_references = challenge.duration_score(6, target)
    assert like_the_references > 0.25
    # And the old behaviour, for contrast.
    assert challenge.duration_score(6, challenge.TARGET_SECONDS_MAX) < 0.15


def test_the_prompt_never_quotes_a_number_next_to_the_clip_length():
    """The badge beside this text reads "10s". The old prompt said "in 30-60
    seconds" and the two read as a contradiction about the same thing."""
    prompt = challenge.describe_prompt(10)
    assert "30-60" not in prompt
    assert "speak" in prompt


def test_speaking_longer_than_asked_is_never_penalised():
    """More production is more production. Docking it would teach the wrong
    lesson about speaking at length."""
    assert challenge.duration_score(200) == 1.0


def test_each_rubric_totals_one_hundred():
    for source, weights in challenge.WEIGHTS.items():
        assert sum(weights.values()) == 100, source


def test_a_perfect_and_an_empty_attempt_bound_the_scale():
    assert challenge.overall_score(relevance=100, grammar=100, duration=1, detail=100) == 100
    assert challenge.overall_score(relevance=0, grammar=0, duration=0, detail=0) == 0


def test_an_unknown_kind_is_rejected(conn):
    with pytest.raises(ValueError):
        challenge.start_round(conn, user_id="u1", kind="interpretive-dance")


# --------------------------------------------------------------------------
# hints


def test_asking_for_hints_is_recorded(conn):
    row = challenge.start_round(conn, user_id="u1")
    challenge.hints_for(conn, row)
    challenge.hints_for(conn, row)
    conn.commit()

    assert conn.execute(
        "SELECT hints_used FROM challenge_rounds WHERE id = ?", (row["id"],)
    ).fetchone()["hints_used"] == 2


# --------------------------------------------------------------------------
# the full attempt


@pytest.fixture()
def fake_judge(monkeypatch):
    def fake(target, system_prompt, user_prompt, **kwargs):
        return {
            "relevance": 82,
            "grammar": 90,
            "note": "Good — watch your past tenses.",
            "corrections": [{"said": "he go", "better": "he went"}],
        }

    monkeypatch.setattr(vocabulary_ai, "_llm_target", lambda conn, user_id: {"provider": "local"})
    monkeypatch.setattr(vocabulary_ai, "_generate_json", fake)


def test_a_scored_attempt_records_both_halves_of_the_rubric(conn, fake_judge):
    """The judged figures and the counted ones are stored separately, so a
    learner disputing a score can see which is which."""
    row = challenge.start_round(conn, user_id="u1")
    said = "A woman is climbing on a hill."

    judged = challenge.judge(conn, user_id="u1", row=row, transcript=said)
    scored = challenge.apply_score(
        conn, row=row, transcript=said,
        speech_seconds=45.0, stt_confidence=0.8, judged=judged,
    )

    assert scored["status"] == "scored"
    # Counted.
    assert scored["duration_score"] == 1.0
    assert scored["content_recall"] is not None
    # Judged.
    assert scored["grammar_score"] == 90
    assert scored["relevance_score"] == 82
    assert scored["overall"] == challenge.overall_score(
        relevance=82, grammar=90, duration=1.0, detail=judged.get("detail")
    )
    feedback = json.loads(scored["feedback"])
    assert feedback["corrections"][0]["better"] == "he went"


def test_the_best_attempt_is_kept_not_the_latest(conn, fake_judge):
    """Two attempts, the second worse. A personal best that moved down with the
    most recent try would not be a best."""
    for seconds in (45.0, 5.0):
        row = challenge.start_round(conn, user_id="u1")
        judged = challenge.judge(conn, user_id="u1", row=row, transcript="Someone does a thing.")
        challenge.apply_score(
            conn, row=row, transcript="Someone does a thing.",
            speech_seconds=seconds, stt_confidence=0.8, judged=judged,
        )
    conn.commit()

    bests = challenge.personal_bests(conn, "u1")
    assert set(bests) == {"describe"}
    scores = [
        r["overall"]
        for r in conn.execute("SELECT overall FROM challenge_rounds WHERE status = 'scored'")
    ]
    assert bests["describe"] == max(scores)
    assert min(scores) < max(scores), "the shorter attempt should have scored lower"


def test_the_round_does_not_hand_over_the_answer_before_it_is_attempted(conn, fake_judge):
    """The ten descriptions ARE the answer, so they must not ship with an
    unscored round — only with the feedback afterwards."""
    from app.routers.challenge import _round_out

    row = challenge.start_round(conn, user_id="u1")
    said = "Someone does a thing."

    before = _round_out(row)
    assert before.reference_captions == []

    judged = challenge.judge(conn, user_id="u1", row=row, transcript=said)
    after = _round_out(
        challenge.apply_score(
            conn, row=row, transcript=said,
            speech_seconds=45.0, stt_confidence=0.8, judged=judged,
        )
    )
    assert len(after.reference_captions) == 10


@pytest.fixture()
def fresh_conn(tmp_path) -> sqlite3.Connection:
    """Migrated, but with no stand-in scenes and no import marker — the two
    tests that exercise the real 34,991-row import need to start empty."""
    c = get_connection(str(tmp_path / "fresh.db"))
    run_migrations(c)
    yield c
    c.close()


def test_the_whole_corpus_imports_and_is_rated_across_levels(fresh_conn):
    from app.services import vatex_scenes

    assert vatex_scenes.ensure_imported(fresh_conn) > 30_000
    assert vatex_scenes.size(fresh_conn) > 30_000
    bands = {r["cefr"] for r in fresh_conn.execute("SELECT DISTINCT cefr FROM vatex_scenes")}
    assert len(bands) >= 4, "a single-band corpus cannot be served by level"
    row = fresh_conn.execute("SELECT * FROM vatex_scenes LIMIT 1").fetchone()
    assert len(json.loads(row["captions"])) >= 8
    # Ten independent descriptions is the whole point of using VATEX.
    assert len(json.loads(row["captions"])) == 10


def test_importing_twice_does_no_work_the_second_time(fresh_conn):
    from app.services import vatex_scenes

    assert vatex_scenes.ensure_imported(fresh_conn) > 0
    assert vatex_scenes.ensure_imported(fresh_conn) == 0


def test_a_youtube_id_containing_an_underscore_survives_parsing(fresh_conn):
    """VATEX keys look like "G9zN5TTuGO4_000179_000189" and YouTube ids may
    themselves contain underscores, so the split has to come from the right."""
    from app.services import vatex_scenes

    vatex_scenes.ensure_imported(fresh_conn)
    rows = fresh_conn.execute("SELECT video_id, start_s, end_s FROM vatex_scenes LIMIT 500").fetchall()
    assert rows
    for row in rows:
        assert 10 <= len(row["video_id"]) <= 12
        assert row["end_s"] > row["start_s"]


def test_the_embed_is_limited_to_the_scene_and_gives_nothing_away():
    """Each of these was verified by rendering the embed and looking at it —
    several of the parameters do not do what their names suggest."""
    from app.services import vatex_scenes

    url = vatex_scenes.embed_url("abc_DEF-123", 179, 189)
    assert url.startswith("https://www.youtube-nocookie.com/embed/abc_DEF-123")
    # Bounded to the ten seconds the describers were shown.
    assert "start=179" in url and "end=189" in url
    # controls=0 is the only thing that removes the title and channel name,
    # which otherwise sit across the top naming the scene outright. It also
    # takes the seek bar with it, so the rest of the video stays out of reach.
    assert "controls=0" in url
    assert "disablekb=1" in url
    # Playback is driven by postMessage because there are no controls left.
    assert "enablejsapi=1" in url
    # Requested off here; the renderer also unloads the captions module,
    # because this parameter alone does not stop auto-captions.
    assert "cc_load_policy=0" in url
    assert "rel=0" in url and "modestbranding=1" in url
    # The no-cookie host, not youtube.com.
    assert "youtube.com/embed" not in url


def test_the_embed_never_offers_the_full_video(fresh_conn):
    """Every scene's embed must be bounded — an unbounded one lets the learner
    watch the whole video, which is a different task entirely."""
    from app.services import vatex_scenes

    vatex_scenes.ensure_imported(fresh_conn)
    for row in fresh_conn.execute("SELECT video_id, start_s, end_s FROM vatex_scenes LIMIT 300"):
        url = vatex_scenes.embed_url(row["video_id"], row["start_s"], row["end_s"])
        assert f"start={row['start_s']}" in url
        assert f"end={row['end_s']}" in url
        assert row["end_s"] > row["start_s"]


def test_a_vatex_round_carries_ten_references_and_no_target_words(conn):
    row = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    assert row is not None
    assert row["source"] == "vatex"
    assert row["video_id"]
    assert len(json.loads(row["reference_captions"])) >= 8
    assert json.loads(row["target_words"]) == []


def test_a_vatex_round_does_not_reveal_the_descriptions_before_the_attempt(conn, fake_judge):
    from app.routers.challenge import _round_out

    row = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    assert _round_out(row).reference_captions == []

    judged = challenge.judge(conn, user_id="u1", row=row, transcript="A man climbs down a snowy cliff.")
    scored = _round_out(
        challenge.apply_score(
            conn, row=row, transcript="A man climbs down a snowy cliff.",
            speech_seconds=40.0, stt_confidence=0.8, judged=judged,
        )
    )
    assert len(scored.reference_captions) >= 8


def test_the_judge_is_given_the_ten_descriptions_as_ground_truth(conn, monkeypatch):
    """The whole reason for using VATEX: the model compares against what people
    who actually watched the clip wrote."""
    seen = {}

    def capture(target, system_prompt, user_prompt, **kwargs):
        seen["system"] = system_prompt
        seen["user"] = user_prompt
        return {"relevance": 70, "detail": 60, "grammar": 80, "note": "", "corrections": []}

    monkeypatch.setattr(vocabulary_ai, "_llm_target", lambda conn, user_id: {"provider": "local"})
    monkeypatch.setattr(vocabulary_ai, "_generate_json", capture)

    row = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    references = json.loads(row["reference_captions"])
    result = challenge.judge(conn, user_id="u1", row=row, transcript="Someone climbs down.")

    assert references[0] in seen["user"], "the references must reach the judge"
    # And it must be told that matching wording is not the test — measured at
    # 0.13 median overlap between two humans on the same clip.
    assert "different words" in seen["system"]
    assert result["detail"] == 60


def test_a_score_weights_accuracy_and_detail(conn, monkeypatch):
    monkeypatch.setattr(vocabulary_ai, "_llm_target", lambda conn, user_id: {"provider": "local"})
    monkeypatch.setattr(
        vocabulary_ai, "_generate_json",
        lambda t, s, u, **k: {"relevance": 90, "detail": 80, "grammar": 70, "note": "", "corrections": []},
    )
    row = challenge.start_round(conn, user_id="u1")
    judged = challenge.judge(conn, user_id="u1", row=row, transcript="A man climbs down a cliff.")
    scored = challenge.apply_score(
        conn, row=row, transcript="A man climbs down a cliff.",
        speech_seconds=45.0, stt_confidence=0.9, judged=judged,
    )
    assert scored["detail_score"] == 80
    assert scored["overall"] == challenge.overall_score(
        relevance=90, grammar=70, duration=1.0, detail=80
    )


def test_the_same_scene_is_not_served_to_a_learner_twice(conn):
    seen = set()
    for _ in range(25):
        row = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
        assert row["video_id"] not in seen
        seen.add(row["video_id"])


def test_a_video_reported_gone_is_never_served_again(conn):
    from app.services import vatex_scenes

    row = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    vatex_scenes.mark_unavailable(conn, row["video_id"])
    conn.commit()

    # A second learner, who has never seen it, must not be served it either:
    # a deleted video is deleted for everyone.
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, cefr_level, created_at) "
        "VALUES ('u2','L2','bn','en','B1',?)",
        (iso8601_utc_now(),),
    )
    conn.commit()

    gone = row["video_id"]
    for _ in range(25):
        nxt = challenge.start_round(conn, user_id="u2", kind="describe", source="vatex")
        assert nxt["video_id"] != gone


def test_an_unknown_source_is_rejected(conn):
    with pytest.raises(ValueError):
        challenge.start_round(conn, user_id="u1", kind="describe", source="tiktok")


def test_skipping_a_scene_retires_it_for_that_learner_only(conn):
    """Two different reasons, two different consequences. "Not interested" is
    about this learner; "it won't play" is about the video."""
    from app.services import vatex_scenes

    first = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    conn.execute("UPDATE challenge_rounds SET status = 'abandoned' WHERE id = ?", (first["id"],))
    conn.commit()

    # Not offered to them again — they have seen it.
    for _ in range(20):
        assert challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")["video_id"] != first["video_id"]

    # But it is still in the pool for everyone else, unlike a reported-gone one.
    assert conn.execute(
        "SELECT COUNT(*) AS n FROM vatex_unavailable WHERE video_id = ?", (first["video_id"],)
    ).fetchone()["n"] == 0
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, cefr_level, created_at) "
        "VALUES ('u3','L3','bn','en','B1',?)",
        (iso8601_utc_now(),),
    )
    conn.commit()
    assert vatex_scenes.pick(conn, user_id="u3", level="B1") is not None


def _reseed(c: sqlite3.Connection, count: int) -> None:
    """Replace the fixture's 60 scenes with exactly `count`, for the tests that
    need the pool to run dry."""
    c.execute("DELETE FROM vatex_scenes")
    _seed_scenes(c, count=count)


# ---------------------------------------------------------------------------
# VATEX: one kind, a real cooldown, and hints made of the ground truth.
# ---------------------------------------------------------------------------


def test_vatex_allows_describe(conn):
    row = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    assert row is not None and row["source"] == "vatex"


def test_a_scene_just_played_is_not_served_again(conn):
    """The whole point of the cooldown. The previous picker excluded a seen
    scene in its first two branches and then dropped the filter entirely in its
    third, so an exhausted band could hand back the same scene immediately."""
    _reseed(conn, 3)
    first = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    seen = set()
    for _ in range(20):
        row = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
        if row is None:
            break
        seen.add(row["video_id"])
    assert first["video_id"] not in seen


def test_the_pool_runs_out_rather_than_repeating(conn):
    """Three scenes, all played: the next call returns None so the router can
    explain the cooldown, instead of silently repeating one."""
    _reseed(conn, 3)
    for _ in range(3):
        assert challenge.start_round(conn, user_id="u1", kind="describe", source="vatex") is not None
    assert challenge.start_round(conn, user_id="u1", kind="describe", source="vatex") is None


def test_a_scene_returns_once_the_cooldown_has_passed(conn):
    """Resting, not retired. A scene described two months ago is worth
    describing again — that second attempt is a real measure of progress."""
    from app.services import vatex_scenes
    from app.utils.time import iso8601_utc_ago

    _reseed(conn, 1)
    challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    assert challenge.start_round(conn, user_id="u1", kind="describe", source="vatex") is None

    conn.execute(
        "UPDATE challenge_rounds SET started_at = ?",
        (iso8601_utc_ago(days=vatex_scenes.COOLDOWN_DAYS + 1),),
    )
    assert challenge.start_round(conn, user_id="u1", kind="describe", source="vatex") is not None


def test_a_video_the_player_could_not_load_leaves_the_pool(conn):
    from app.services import vatex_scenes

    _reseed(conn, 2)
    # A second learner, to prove the exclusion is global rather than just this
    # learner's cooldown: a video that has gone has gone for everyone.
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, cefr_level, created_at) "
        "VALUES ('u2','Other','bn','en','B1',?)",
        (iso8601_utc_now(),),
    )
    first = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    vatex_scenes.mark_playback_error(conn, first["video_id"], "embed refused")
    for _ in range(10):
        row = challenge.start_round(conn, user_id="u2", kind="describe", source="vatex")
        assert row is None or row["video_id"] != first["video_id"]


def test_caption_hints_are_graded_and_priced():
    captions = [
        "A man in a red shirt is cooking pasta in a kitchen.",
        "A person cooks noodles on a stove.",
        "A man stirs a pot of boiling pasta.",
        "Someone is preparing food in a kitchen.",
        "A chef boils pasta in a large pot.",
        "A man cooking spaghetti on the stovetop.",
        "A guy in a kitchen stirring a pot.",
        "A man prepares a pasta dish.",
        "A person stirs noodles in boiling water.",
        "A man wearing red cooks pasta.",
    ]
    one = challenge.caption_hints(captions, 1)
    two = challenge.caption_hints(captions, 2)
    three = challenge.caption_hints(captions, 3)

    assert one["consensus_words"] and not one["example_caption"]
    assert two["detail_words"] and not two["example_caption"]
    assert three["example_caption"] in captions
    # Each tier costs strictly more than the one before.
    assert one["penalty"] < two["penalty"] < three["penalty"]
    # And the next price is quoted before it is paid.
    assert one["next_penalty"] == two["penalty"]
    assert three["next_penalty"] is None


def test_inflections_count_as_one_thing_noticed_by_several_people():
    """"cooks", "cooking" and "cooked" are three people noticing the same
    thing, not three different things. Counting raw surface forms — which is
    what cefr_lexicon.normalise alone does, since it only lowercases — split
    them apart and buried the word nobody could then see was the consensus."""
    captions = ["a man cooks", "a man is cooking", "a man cooked food", "a dog barks"]
    tally = dict(challenge.caption_agreement(captions))
    merged = [n for w, n in tally.items() if n == 3]
    assert merged, f"expected one word agreed by three describers, got {tally}"


def test_the_example_hint_is_the_most_typical_description():
    """The medoid, not the first. The ten arrive in arbitrary order and the
    first is as likely to be the odd one out as any other."""
    captions = ["a man rides a horse along a beach"] * 4 + ["something entirely unrelated indoors"]
    assert challenge.representative_caption(captions) == "a man rides a horse along a beach"


def test_hints_cost_the_learner_points(conn):
    row = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    challenge.hints_for(conn, row, level=2)
    after = conn.execute("SELECT * FROM challenge_rounds WHERE id = ?", (row["id"],)).fetchone()
    assert after["hint_level"] == 2
    assert after["hint_penalty"] == challenge.HINT_TARIFF[2]


def test_a_hint_once_taken_cannot_be_walked_back(conn):
    """Reopening the panel at a lower tier must not refund a reveal."""
    row = challenge.start_round(conn, user_id="u1", kind="describe", source="vatex")
    challenge.hints_for(conn, row, level=3)
    row = conn.execute("SELECT * FROM challenge_rounds WHERE id = ?", (row["id"],)).fetchone()
    challenge.hints_for(conn, row, level=1)
    after = conn.execute("SELECT * FROM challenge_rounds WHERE id = ?", (row["id"],)).fetchone()
    assert after["hint_level"] == 3


def test_an_import_that_found_no_corpus_is_not_recorded_as_done(conn, monkeypatch):
    """The marker used to be written unconditionally. With the data file
    missing, that left the table permanently empty: every later launch saw the
    marker, skipped the import, and told the learner they had worked through
    every scene when they had been served none."""
    from app.services import vatex_scenes

    conn.execute("DELETE FROM app_meta WHERE key = 'vatex_scenes_imported'")
    monkeypatch.setattr(vatex_scenes, "_iter_file", lambda: [])
    assert vatex_scenes.ensure_imported(conn) == 0
    marker = conn.execute(
        "SELECT value FROM app_meta WHERE key = 'vatex_scenes_imported'"
    ).fetchone()
    assert marker is None, "a failed import must stay retryable"


def test_personal_bests_omit_a_kind_never_played(conn):
    """Absent, not zero — a learner who has never played a kind has not scored
    nought at it."""
    assert "predict" not in challenge.personal_bests(conn, "u1")


# ---------------------------------------------------------------------------
# Content recall, and the enriched description.
# ---------------------------------------------------------------------------

_PASTA = [
    "A man stirs a pot of boiling pasta.",
    "A person cooks noodles on a stove.",
    "A chef boils pasta in a large pot.",
    "A man cooking spaghetti on the stovetop.",
    "A guy in a kitchen stirring a pot.",
    "A man prepares a pasta dish.",
    "A person stirs noodles in boiling water.",
    "A man wearing red cooks pasta.",
    "Someone is preparing food in a kitchen.",
    "A man in a red shirt is cooking pasta.",
]


def test_content_recall_rewards_reaching_what_the_describers_noticed():
    good = challenge.content_recall("A man is cooking pasta in a pot in a kitchen", _PASTA)
    vague = challenge.content_recall("A person does something", _PASTA)
    wrong = challenge.content_recall("A dog runs across a field", _PASTA)
    assert good > 0.4
    assert vague == 0.0
    assert wrong == 0.0


def test_content_recall_is_none_with_nothing_to_compare_against():
    """Not zero. A library round has no reference descriptions at all, and
    reporting 0% recall would be a measurement of something that was never
    asked."""
    assert challenge.content_recall("anything at all", []) is None


def test_content_recall_weights_by_how_many_people_agreed():
    """Missing a word nine describers used is a real gap; missing one that two
    used is not. An unweighted count would treat them the same."""
    consensus_only = challenge.content_recall("pasta", _PASTA)
    detail_only = challenge.content_recall("red", _PASTA)
    assert consensus_only > detail_only


def _scored_vatex_round(conn, captions):
    rid = uuid7()
    conn.execute(
        "INSERT INTO challenge_rounds (id, user_id, kind, source, video_id, start_s, end_s, "
        "media_title, reference_captions, target_words, prompt, status, started_at) "
        "VALUES (?, 'u1', 'describe', 'vatex', 'vid1', 0, 10, 't', ?, '[]', 'p', 'scored', ?)",
        (rid, json.dumps(captions), iso8601_utc_now()),
    )
    return conn.execute("SELECT * FROM challenge_rounds WHERE id = ?", (rid,)).fetchone()


def test_enrichment_keeps_only_words_that_are_really_in_the_text(conn, monkeypatch):
    """A model asked which words it used will name ones it did not. The claim
    is checked against the text before anything is stored."""
    _word(conn, "simmer")
    _word(conn, "aardvark")
    row = _scored_vatex_round(conn, _PASTA)

    monkeypatch.setattr(vocabulary_ai, "_llm_target", lambda conn, user_id: {"provider": "local"})
    monkeypatch.setattr(
        vocabulary_ai,
        "_generate_json",
        lambda *a, **k: {
            "description": "A man simmers a pot of pasta in a kitchen.",
            "used_words": [
                {"word": "simmer", "why": "the pot is boiling"},
                {"word": "aardvark", "why": "invented"},
            ],
        },
    )
    out = challenge.enrich(conn, user_id="u1", row=row)
    words = {w["word"] for w in out["used_words"]}
    assert "simmer" in words, "an inflected use must still count"
    assert "aardvark" not in words, "a word only claimed, never written, must be dropped"


def test_enrichment_credits_a_word_used_but_not_declared(conn, monkeypatch):
    """The other direction: the model can use a word without listing it, and
    the count shown to the learner has to match what is on the page."""
    _word(conn, "stove")
    row = _scored_vatex_round(conn, _PASTA)
    monkeypatch.setattr(vocabulary_ai, "_llm_target", lambda conn, user_id: {"provider": "local"})
    monkeypatch.setattr(
        vocabulary_ai,
        "_generate_json",
        lambda *a, **k: {"description": "A man cooks pasta on a stove.", "used_words": []},
    )
    out = challenge.enrich(conn, user_id="u1", row=row)
    assert [w["word"] for w in out["used_words"]] == ["stove"]


def test_enrichment_is_cached_rather_than_regenerated(conn, monkeypatch):
    """It costs a real model call. Reopening a past round must show what was
    shown before, not charge again for something different."""
    _word(conn, "stove")
    row = _scored_vatex_round(conn, _PASTA)
    calls = []

    def once(*a, **k):
        calls.append(1)
        return {"description": "A man cooks pasta on a stove.", "used_words": []}

    monkeypatch.setattr(vocabulary_ai, "_llm_target", lambda conn, user_id: {"provider": "local"})
    monkeypatch.setattr(vocabulary_ai, "_generate_json", once)
    challenge.enrich(conn, user_id="u1", row=row)
    row = conn.execute("SELECT * FROM challenge_rounds WHERE id = ?", (row["id"],)).fetchone()
    second = challenge.enrich(conn, user_id="u1", row=row)
    assert len(calls) == 1
    assert second["cached"] is True


def test_enrichment_refuses_a_round_with_no_references(conn):
    """A library round has nothing to enrich — the feature exists because VATEX
    supplies ten descriptions and a library clip supplies none."""
    rid = uuid7()
    conn.execute(
        "INSERT INTO challenge_rounds (id, user_id, kind, source, media_title, target_words, "
        "prompt, status, started_at) VALUES (?, 'u1', 'describe', 'library', 't', '[]', 'p', "
        "'scored', ?)",
        (rid, iso8601_utc_now()),
    )
    row = conn.execute("SELECT * FROM challenge_rounds WHERE id = ?", (rid,)).fetchone()
    with pytest.raises(ValueError, match="no reference"):
        challenge.enrich(conn, user_id="u1", row=row)


def test_enrichment_offers_due_words_first(conn):
    """A word met again in a fresh context on the day it is due is the whole
    point of drawing on the learner's own vocabulary."""
    from app.utils.time import iso8601_utc_ago

    _word(conn, "zebra", due=None)
    due = _word(conn, "simmer", due=iso8601_utc_ago(days=1))
    order = [r["word"] for r in challenge.enrichment_candidates(conn, "u1")]
    assert order[0] == "simmer", f"due word should lead, got {order}"
