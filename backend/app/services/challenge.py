"""Spec §6.4 — Scene Description Challenge.

A ten-second VATEX scene is played without subtitles and the learner describes
what happened. The attempt is then scored against the ten descriptions that
real people wrote of the same clip.

**Only VATEX.** Rounds built from the learner's own saved clips were removed:
a library clip has no description of what is on screen, so "relevance" had to
be inferred from the line of dialogue spoken in it, which is not the same
question. The ten human descriptions are the entire reason this feature can
mark anything honestly, and a source that has none of them was marking on a
different, weaker basis while looking identical. Rounds already played that way
are still readable — the table keeps them, and the `source` and `kind` checks
still accept them — they simply cannot be started any more.

**Why the score is not lexical overlap.** The spec asks for "semantic overlap
with a reference description", and the obvious reading is word overlap against
a reference. Measured against VATEX — 3,000 clips, ten human descriptions
each — ten people watching the *same* clip share a median of 0.13 of their
content words, and even the closest-matching pair of humans reaches only 0.28.
Word overlap between two correct descriptions is therefore mostly noise, and
scoring a learner on it would mostly measure which synonyms they happened to
pick. Relevance is judged semantically by the model instead, and the two parts
of the score that *can* be computed exactly — did they use the target words,
did they speak for long enough — are computed exactly and kept separate.
"""

import json
import random
import sqlite3

from app.services import (
    cefr_lexicon,
    conversation_report,
    vatex_scenes,
    vocabulary_ai,
)
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

# The table's CHECK constraints still accept every historical value, so rounds
# played before this was narrowed stay readable. These are what can be STARTED.
KINDS = ("describe",)
SOURCES = ("vatex",)

VATEX_KINDS = KINDS

# How long the learner should speak, which is NOT how long the clip is.
#
# Spec §6.4 says "narrate what happened in 30-60 seconds", and that was taken
# literally as a fixed 45-second target for full marks. Measured against what
# is actually on screen, that is wrong in both directions:
#
#   every VATEX scene is exactly 10 seconds (all 34,991 of them — the corpus is
#     built from 10-second Kinetics clips), and the library clips saved so far
#     run 1-10 seconds
#   the ten reference descriptions have a median of 14 words, which read aloud
#     is about 6 seconds
#
# So a learner who described a clip exactly as well as the ten humans did scored
# 6/45 on the duration component — 13% — for matching the ground truth. The only
# way to score well was to pad, and padding is separately measured as filler.
# The target is now proportional to the clip, with a floor that still demands
# real sentences and a ceiling that keeps the spec's figure for a long clip.
TARGET_SPEECH_PER_CLIP_SECOND = 2.0
TARGET_SECONDS_MIN = 15.0
TARGET_SECONDS_MAX = 45.0


def clip_seconds(row: sqlite3.Row) -> float:
    """How long the clip itself runs. VATEX carries whole seconds; a library
    clip carries milliseconds."""
    if _has(row, "source") and row["source"] == "vatex":
        start, end = row["start_s"] or 0, row["end_s"] or 0
        return max(0.0, float(end - start))
    return max(0.0, (row["end_ms"] - row["start_ms"]) / 1000)


def duration_target(clip_s: float) -> float:
    """Seconds of speech worth full marks for a clip of this length."""
    return max(TARGET_SECONDS_MIN, min(TARGET_SECONDS_MAX, clip_s * TARGET_SPEECH_PER_CLIP_SECOND))

# Each set sums to 100. Coverage and duration are arithmetic; the rest is the
# model's opinion, and is deliberately the larger half — a description that
# uses every target word but does not describe the scene has not done the task.
#
# Accuracy against the ten carries the most weight; "detail" — how much of what
# the describers collectively noticed the learner noticed — is answerable only
# because those ten exist.
WEIGHTS = {
    "vatex": {"relevance": 45, "detail": 20, "grammar": 25, "duration": 10},
}

def describe_prompt(clip_s: float) -> str:
    """Says how long to SPEAK, and never mentions a number that could be
    mistaken for the clip's own length.

    The old text — "Describe what happened in the clip, in 30-60 seconds" — sat
    directly beside a badge reading "10s", so the two numbers read as a
    contradiction about the same thing. They were never about the same thing.
    """
    return (
        f"Describe what happened in the clip. Aim to speak for about "
        f"{round(duration_target(clip_s))} seconds."
    )




def start_round(
    conn: sqlite3.Connection, *, user_id: str, kind: str = "describe", source: str = "vatex"
) -> sqlite3.Row | None:
    """Open a round. Both arguments are kept so callers and stored rows keep
    their shape, but there is exactly one of each to choose from now."""
    if kind not in KINDS:
        raise ValueError(f"unknown challenge kind: {kind}")
    if source not in SOURCES:
        raise ValueError(f"unknown challenge source: {source}")
    return _start_vatex(conn, user_id, kind)


def _start_vatex(conn: sqlite3.Connection, user_id: str, kind: str) -> sqlite3.Row | None:
    # Cheap after the first call — it reads one app_meta row and returns.
    vatex_scenes.ensure_imported(conn)
    level = conn.execute("SELECT cefr_level FROM users WHERE id = ?", (user_id,)).fetchone()
    scene = vatex_scenes.pick(conn, user_id=user_id, level=level["cefr_level"] if level else None)
    if scene is None:
        return None

    round_id = uuid7()
    conn.execute(
        """
        INSERT INTO challenge_rounds (id, user_id, kind, source, video_id, start_s, end_s,
                                      media_title, reference_captions, target_words, prompt,
                                      status, started_at)
        VALUES (?, ?, ?, 'vatex', ?, ?, ?, ?, ?, '[]', ?, 'open', ?)
        """,
        (
            round_id,
            user_id,
            kind,
            scene.video_id,
            scene.start_s,
            scene.end_s,
            f"VATEX scene · {scene.cefr}",
            json.dumps(list(scene.captions)),
            describe_prompt(scene.end_s - scene.start_s),
            iso8601_utc_now(),
        ),
    )
    return conn.execute("SELECT * FROM challenge_rounds WHERE id = ?", (round_id,)).fetchone()


# ---------------------------------------------------------------------------
# Hints drawn from the ten reference descriptions.
# ---------------------------------------------------------------------------
# The ten are the answer. Any hint taken from them hands over part of it, so
# hints here are graded, priced, and priced VISIBLY — the learner is told what
# a tier costs before they open it, not after.
#
# The tiers go from vocabulary to content on purpose. Level 1 gives the words
# without the scene: a shuffled bag of what most describers reached for, which
# helps a learner who knows what they saw but cannot name it, and helps very
# little otherwise. Level 3 gives an actual description, which is most of the
# answer, and is priced accordingly.

HINT_TARIFF = (0, 4, 8, 15)  # cumulative points forfeited at each level
MAX_HINT_LEVEL = 3

# How many words each tier shows. Fixed counts rather than an agreement
# threshold: a cutoff of "five of the ten mentioned it" sounds principled and
# returns almost nothing, because ten people describing one clip share a median
# of 0.13 of their content words — the same measurement the scoring rubric is
# built on. Taking the top of the ranking gives a useful handful whatever the
# scene, and the agreement count travels with each word so the interface can
# show how many people said it.
_CONSENSUS_SHOWN = 7   # level 1: the most widely agreed words
_DETAIL_SHOWN = 6      # level 2: what a few noticed
_MIN_AGREEMENT = 2     # never show a word only one describer used

# Function words carry no information about a scene and would crowd out the
# words that do. Deliberately a fixed list rather than a frequency cutoff: the
# corpus is ten sentences long, so "frequent here" and "frequent in English"
# are indistinguishable at this sample size.
_STOP = frozenset("""
a an the and or but if then than that this these those there here is are was were be been being
am do does did doing have has had having will would shall should can could may might must
of in on at to for with from by as into onto over under about after before during while
he she it they them his her its their him we us you your i me my our not no nor so very
someone something people person man woman boy girl guy lady thing things other another
some any all both each few more most much many one two three several who whom which what
when where why how out up down off then once again also just only own same too s t
using use used get gets got go goes going goes seen see look looks looking
wearing wear wears make makes made front back next near around through
""".split())


def _content_words(text: str) -> list[str]:
    """Content words from one description, deduplicated, in order."""
    seen: list[str] = []
    for raw in conversation_report._words(text):
        if raw in _STOP or len(raw) < 3:
            continue
        if raw not in seen:
            seen.append(raw)
    return seen


def _cluster(words: list[str]) -> dict[str, str]:
    """Maps each surface word to a canonical form for its inflection family.

    cefr_lexicon.normalise only lowercases, so counting on it left "cooks",
    "cooking" and "cooked" as three separate things that three different people
    had noticed — which is exactly backwards, since they are three people
    noticing the SAME thing. Words are grouped the way says_word already
    decides two forms are the same word: their base-form sets intersect. The
    shortest surface form in a family represents it, which is the one a learner
    is most likely to be able to use.
    """
    families: list[set[str]] = []   # base-form sets
    members: list[list[str]] = []
    for word in words:
        forms = cefr_lexicon.base_forms(word)
        for i, fam in enumerate(families):
            if fam & forms:
                fam |= forms
                members[i].append(word)
                break
        else:
            families.append(set(forms))
            members.append([word])
    canon: dict[str, str] = {}
    for group in members:
        rep = min(group, key=lambda w: (len(w), w))
        for word in group:
            canon[word] = rep
    return canon


def caption_agreement(captions: list[str]) -> list[tuple[str, int]]:
    """Every content word with the number of describers who used it, most
    agreed-upon first.

    Counted per describer, not per occurrence: someone who says "dog" three
    times is still one person who mentioned a dog. Inflections are folded
    together first, so "runs" and "running" are one observation shared by two
    people rather than two observations held by one each.
    """
    per_caption = [_content_words(c) for c in captions]
    canon = _cluster([w for words in per_caption for w in words])
    tally: dict[str, int] = {}
    for words in per_caption:
        for lemma in {canon.get(w, w) for w in words}:
            tally[lemma] = tally.get(lemma, 0) + 1
    return sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))


def representative_caption(captions: list[str]) -> str:
    """The most typical of the ten — the one sharing the most vocabulary with
    the rest.

    Picking the medoid rather than the first: the ten arrive in arbitrary
    order, and the first is as likely to be the idiosyncratic one as any other.
    The medoid is the description that, if you only ever saw one, would mislead
    you least.
    """
    if not captions:
        return ""
    bags = [set(_content_words(c)) for c in captions]
    best, best_score = captions[0], -1.0
    for i, caption in enumerate(captions):
        if not bags[i]:
            continue
        score = sum(
            len(bags[i] & bags[j]) / len(bags[i] | bags[j])
            for j in range(len(captions))
            if j != i and (bags[i] | bags[j])
        )
        if score > best_score:
            best, best_score = caption, score
    return best


def caption_hints(captions: list[str], level: int) -> dict:
    """What to reveal at each level. Cumulative — level 2 includes level 1."""
    level = max(0, min(MAX_HINT_LEVEL, int(level)))
    agreement = caption_agreement(captions)
    out: dict = {
        "level": level,
        "max_level": MAX_HINT_LEVEL,
        "penalty": HINT_TARIFF[level],
        "next_penalty": HINT_TARIFF[level + 1] if level < MAX_HINT_LEVEL else None,
        "consensus_words": [],
        "detail_words": [],
        "example_caption": None,
        "describer_count": len(captions),
    }
    if level >= 1:
        # Shuffled, not ranked: showing them in agreement order would leak the
        # shape of the scene on top of the vocabulary, which is the next tier's
        # job. The seed is the caption text, so the same round always shows the
        # same order and re-opening the panel does not reshuffle.
        ranked = [(w, n) for w, n in agreement if n >= _MIN_AGREEMENT]
        top = ranked[:_CONSENSUS_SHOWN]
        rng = random.Random(" ".join(captions[:2]))
        rng.shuffle(top)
        out["consensus_words"] = [{"word": w, "describers": n} for w, n in top]
    if level >= 2:
        shown = {d["word"] for d in out["consensus_words"]}
        rest = [(w, n) for w, n in agreement if n >= _MIN_AGREEMENT and w not in shown]
        out["detail_words"] = [
            {"word": w, "describers": n} for w, n in rest[:_DETAIL_SHOWN]
        ]
    if level >= 3:
        out["example_caption"] = representative_caption(captions)
    return out


def hints_for(conn: sqlite3.Connection, row: sqlite3.Row, *, level: int | None = None) -> dict:
    """Graded reveals from the ten descriptions, at a stated price.

    The ten are the answer, so a hint taken from them hands over part of it.
    The tiers, and why they are priced, are described above the tariff.
    """
    captions = json.loads(row["reference_captions"] or "[]")
    current = row["hint_level"] if _has(row, "hint_level") else 0
    wanted = (current or 0) + 1 if level is None else int(level)
    wanted = max(0, min(MAX_HINT_LEVEL, wanted))
    # Never walk a level back: a hint once seen cannot be unseen, so the price
    # already paid stands even if the panel is reopened at a lower tier.
    wanted = max(wanted, current or 0)

    hints = caption_hints(captions, wanted)
    conn.execute(
        "UPDATE challenge_rounds SET hint_level = ?, hint_penalty = ?, "
        "hints_used = hints_used + 1 WHERE id = ?",
        (wanted, HINT_TARIFF[wanted], row["id"]),
    )
    return hints


def duration_score(speech_seconds: float | None, target: float | None = None) -> float:
    """Full marks for speaking as long as the task asks, pro rata below it.

    `target` is the clip's own target from duration_target(); the default keeps
    the old fixed figure for callers that have no clip to hand.

    Deliberately not penalised above the range: a learner who talks for ninety
    seconds has done more production, not less, and docking them for it would
    teach exactly the wrong lesson.
    """
    if not speech_seconds or speech_seconds <= 0:
        return 0.0
    return min(1.0, speech_seconds / (target or TARGET_SECONDS_MAX))


# The VATEX rubric. The ten descriptions are what ten people independently
# wrote after watching this exact clip, so for once the judge is comparing
# against something real rather than inferring from dialogue.
#
# The warning about wording is not politeness — it is measured. Across 3,000
# VATEX scenes, two humans describing the same clip share a median of 0.13 of
# their content words, and the closest-matching pair only 0.28. A model told to
# check "does this match the reference" without that context marks correct
# descriptions down for choosing different synonyms.
_VATEX_JUDGE = (
    "You are marking a language learner's spoken description of a short video clip. "
    "You cannot see the clip, but you are given ten descriptions of it written independently by "
    "people who did. Treat those ten together as the ground truth: anything most of them agree on "
    "happened, and anything only one mentions is a detail, not a requirement. "
    "IMPORTANT: people describing the same clip use very different words — two of these ten "
    "typically share only about an eighth of their vocabulary. Judge what the learner understood, "
    "never which words they picked. A description using none of the reference wording can be "
    "completely correct. "
    "Respond with ONLY a JSON object (no prose, no markdown fences) with exactly these keys: "
    '"relevance": integer 0-100 — is this the same scene the ten describe, '
    '"detail": integer 0-100 — how much of what they collectively noticed did the learner notice, '
    '"grammar": integer 0-100 — accuracy of the English, ignoring speech-to-text punctuation, '
    '"note": one short sentence naming the single most useful thing to fix or notice next time, '
    '"corrections": an array of up to 3 objects {"said": string, "better": string} quoting the '
    "learner's own words. Return an empty array if there is nothing worth correcting."
)


def judge(conn: sqlite3.Connection, *, user_id: str, row: sqlite3.Row, transcript: str) -> dict:
    """The half of the score that needs a model. Raises EngineUnavailable when
    the AI is not launched, which the router turns into an actionable 503."""
    references = json.loads(row["reference_captions"] or "[]") if _has(row, "reference_captions") else []
    if not references:
        raise ValueError("This round has no reference descriptions to mark against.")

    target = vocabulary_ai._llm_target(conn, user_id)
    listed = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(references))
    user_prompt = (
        f"Task given to the learner: {row['prompt']}\n\n"
        f"Ten people who watched the clip described it as:\n{listed}\n\n"
        f"What the learner said: \"{transcript}\""
    )
    raw = vocabulary_ai._generate_json(target, _VATEX_JUDGE, user_prompt, max_tokens=520)

    def _score(key: str) -> int:
        try:
            return max(0, min(100, int(raw.get(key))))
        except (TypeError, ValueError):
            return 0

    corrections = []
    for item in raw.get("corrections") or []:
        if isinstance(item, dict) and item.get("said") and item.get("better"):
            corrections.append({"said": str(item["said"])[:200], "better": str(item["better"])[:200]})
    return {
        "relevance": _score("relevance"),
        "grammar": _score("grammar"),
        "detail": _score("detail"),
        "note": str(raw.get("note") or "").strip()[:300],
        "corrections": corrections[:3],
    }


# ---------------------------------------------------------------------------
# Content recall — the deterministic half of "did they notice what was there".
# ---------------------------------------------------------------------------
# `detail` is asked of the model, and a model asked to estimate a proportion
# will produce a plausible-looking number whether or not it counted anything.
# The ten descriptions reduce to content words with a count of how many people
# used each; what share of that the learner reached is arithmetic.
#
# Weighted by agreement on purpose. Missing a word nine describers used is a
# real gap; missing one that two used is not, and an unweighted count would
# treat them the same.


def content_recall(transcript: str, captions: list[str]) -> float | None:
    """Share of the describers' collective observations the learner reached,
    0-1, weighted by how many of them made each observation.

    None when there is nothing to compare against — the same distinction the
    rest of the report draws between "nothing to measure" and "measured nought".
    """
    if not captions:
        return None
    agreement = [(w, n) for w, n in caption_agreement(captions) if n >= _MIN_AGREEMENT]
    if not agreement:
        return None
    total = sum(n for _, n in agreement)
    hit = sum(n for w, n in agreement if conversation_report.says_word(transcript, w))
    return round(hit / total, 3) if total else None


# ---------------------------------------------------------------------------
# The enriched description.
# ---------------------------------------------------------------------------

# How many of the learner's words to offer. More than this and a small model
# starts forcing them in; fewer and there is rarely anything that fits.
_ENRICH_WORD_CANDIDATES = 12

_ENRICH_SYSTEM = (
    "You write a single vivid English description of a short video clip, for a language learner "
    "to read after they have described it themselves.\n"
    "You are given ten descriptions written independently by people who watched the clip. "
    "Those ten are your ONLY source of fact. Combine what they collectively saw into one "
    "coherent paragraph of 3-5 sentences, richer and better organised than any one of them.\n"
    "NEVER invent anything none of them mention — no colours, names, places, emotions or actions "
    "that are not in the ten. If they disagree, prefer what most of them say.\n"
    "You are also given words the learner is currently trying to learn. Work in ONLY the ones "
    "that genuinely fit what happened, used correctly and naturally. Forcing an unrelated word in "
    "is worse than using none — it teaches the wrong context. Using none is a perfectly good "
    "answer.\n"
    "Respond with ONLY a JSON object (no prose, no markdown fences) with exactly these keys: "
    '"description": the paragraph, '
    '"used_words": an array of {"word": the learner word exactly as given, "why": a short reason '
    "it fits this scene}. Return an empty array if none fitted."
)


def enrichment_candidates(conn: sqlite3.Connection, user_id: str) -> list[sqlite3.Row]:
    """The learner's words worth trying to work in, most useful first.

    Due-for-review words come first: a word met again in a fresh context on the
    day it is due is the whole idea behind this feature. Words never reviewed
    come next, then the rest by recency.
    """
    return conn.execute(
        """
        SELECT w.id, w.word, w.definition, w.pos,
               CASE WHEN r.due IS NOT NULL AND r.due <= ? AND r.suspended = 0 THEN 0
                    WHEN r.vocab_word_id IS NULL THEN 1
                    ELSE 2 END AS priority
          FROM vocab_words w
          LEFT JOIN review_cards r ON r.vocab_word_id = w.id
         WHERE w.user_id = ?
         ORDER BY priority ASC, w.created_at DESC
         LIMIT ?
        """,
        (iso8601_utc_now(), user_id, _ENRICH_WORD_CANDIDATES),
    ).fetchall()


def enrich(conn: sqlite3.Connection, *, user_id: str, row: sqlite3.Row) -> dict:
    """A richer description of the scene, built from the ten, using the
    learner's own vocabulary where it fits.

    Cached on the round: it costs a real model call, and a learner reopening a
    past round should see what they saw before rather than pay again for
    something different.
    """
    if _has(row, "enriched_text") and row["enriched_text"]:
        return {
            "description": row["enriched_text"],
            "used_words": json.loads(row["enriched_words"] or "[]"),
            "cached": True,
        }

    captions = json.loads(row["reference_captions"] or "[]")
    if not captions:
        raise ValueError("This round has no reference descriptions to build on.")

    candidates = enrichment_candidates(conn, user_id)
    listed = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(captions))
    vocab = (
        "\n".join(f"- {w['word']}: {w['definition'] or 'no definition on file'}" for w in candidates)
        or "(the learner has no saved vocabulary yet — just write the description)"
    )
    user_prompt = (
        f"The ten people who watched the clip described it as:\n{listed}\n\n"
        f"Words the learner is trying to learn:\n{vocab}"
    )

    target = vocabulary_ai._llm_target(conn, user_id)
    raw = vocabulary_ai._generate_json(target, _ENRICH_SYSTEM, user_prompt, max_tokens=600)

    description = str(raw.get("description") or "").strip()
    if not description:
        raise ValueError("The model returned no description — try again.")

    # A model asked which words it used will name ones it did not. Check the
    # text itself, and match on base forms so a word used in another inflection
    # still counts — "stirred" is "stir".
    by_word = {w["word"].lower(): w for w in candidates}
    used: list[dict] = []
    for item in raw.get("used_words") or []:
        if not isinstance(item, dict):
            continue
        claimed = str(item.get("word") or "").strip()
        entry = by_word.get(claimed.lower())
        if entry is None:
            continue
        if not conversation_report.says_word(description, entry["word"]):
            continue  # claimed but not actually there
        if any(u["vocab_word_id"] == entry["id"] for u in used):
            continue
        used.append(
            {
                "word": entry["word"],
                "vocab_word_id": entry["id"],
                "why": str(item.get("why") or "").strip()[:200],
            }
        )

    # The model can also use a word without listing it. Credit that too, so the
    # count shown to the learner matches what is actually on the page.
    for entry in candidates:
        if any(u["vocab_word_id"] == entry["id"] for u in used):
            continue
        if conversation_report.says_word(description, entry["word"]):
            used.append({"word": entry["word"], "vocab_word_id": entry["id"], "why": ""})

    conn.execute(
        "UPDATE challenge_rounds SET enriched_text = ?, enriched_words = ?, enriched_at = ? "
        "WHERE id = ?",
        (description, json.dumps(used), iso8601_utc_now(), row["id"]),
    )
    return {"description": description, "used_words": used, "cached": False}


def _has(row: sqlite3.Row, column: str) -> bool:
    return column in row.keys()


def overall_score(
    *,
    relevance: int,
    grammar: int,
    duration: float,
    detail: int | None = None,
    source: str = "vatex",
) -> int:
    """Weighted total, 0-100.

    A component that cannot be measured is *dropped and the rest rescaled*,
    never scored as zero — so a judge that returns no `detail` costs its 20
    points from the total rather than scoring nought against them.
    """
    w = dict(WEIGHTS[source])
    parts: dict[str, float] = {
        "relevance": relevance / 100,
        "grammar": grammar / 100,
        "duration": duration,
    }
    if "detail" in w:
        if detail is None:
            del w["detail"]
        else:
            parts["detail"] = detail / 100

    total_weight = sum(w.values()) or 1
    earned = sum(parts[k] * weight for k, weight in w.items())
    return round(100 * earned / total_weight)


def apply_score(
    conn: sqlite3.Connection,
    *,
    row: sqlite3.Row,
    transcript: str,
    speech_seconds: float,
    stt_confidence: float,
    judged: dict,
) -> sqlite3.Row:
    source = "vatex"
    duration = duration_score(speech_seconds, duration_target(clip_seconds(row)))
    references = json.loads(row["reference_captions"] or "[]") if _has(row, "reference_captions") else []
    recall = content_recall(transcript, references)
    raw_overall = overall_score(
        relevance=judged["relevance"],
        grammar=judged["grammar"],
        duration=duration,
        detail=judged.get("detail"),
        source=source,
    )
    # Hints taken from the ten descriptions are part of the answer, so they are
    # deducted here rather than quietly ignored. Both numbers are stored: the
    # learner is shown what the description itself was worth and what the help
    # cost, which is more useful than one number that silently absorbed both.
    penalty = row["hint_penalty"] if _has(row, "hint_penalty") else 0
    overall = max(0, raw_overall - (penalty or 0))
    feedback = {"note": judged["note"], "corrections": judged["corrections"]}
    conn.execute(
        """
        UPDATE challenge_rounds
           SET transcript = ?, speech_seconds = ?, stt_confidence = ?,
               duration_score = ?, grammar_score = ?, relevance_score = ?,
               detail_score = ?, content_recall = ?, raw_overall = ?, overall = ?, feedback = ?,
               status = 'scored', scored_at = ?
         WHERE id = ?
        """,
        (
            transcript,
            speech_seconds,
            stt_confidence,
            duration,
            judged["grammar"],
            judged["relevance"],
            judged.get("detail"),
            recall,
            raw_overall,
            overall,
            json.dumps(feedback),
            iso8601_utc_now(),
            row["id"],
        ),
    )
    return conn.execute("SELECT * FROM challenge_rounds WHERE id = ?", (row["id"],)).fetchone()


def personal_bests(conn: sqlite3.Connection, user_id: str) -> dict[str, int]:
    rows = conn.execute(
        "SELECT kind, MAX(overall) AS best FROM challenge_rounds "
        "WHERE user_id = ? AND status = 'scored' AND overall IS NOT NULL GROUP BY kind",
        (user_id,),
    ).fetchall()
    # Kinds with nothing scored are absent rather than present-and-zero. A
    # learner who has never played a kind has not scored nought at it, and the
    # interface shows the two differently.
    return {r["kind"]: r["best"] for r in rows if r["best"] is not None}


def history(conn: sqlite3.Connection, user_id: str, *, limit: int = 20) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM challenge_rounds WHERE user_id = ? AND status = 'scored' "
        "ORDER BY scored_at DESC LIMIT ?",
        (user_id, limit),
    ).fetchall()
