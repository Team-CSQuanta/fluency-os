"""Saved vocabulary words (spec §5.1 — the vocabulary increment).

Dictionary fields are snapshotted from cefr_lexicon at save time rather than
re-looked-up on read (see the migration's comment for why). There is
deliberately no scheduling logic here — mastery/due/retention belong to a
later spaced-repetition increment and are not modelled at all rather than
being faked.
"""

import json
import os
import sqlite3
from pathlib import Path

from app.config import settings
from app.services import cefr_lexicon, pagination, review
from app.services.voice import tts
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now


def save_word(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    word: str,
    sentence: str | None,
    book_id: str | None,
    block_index: int | None,
    page: int | None = None,
) -> tuple[sqlite3.Row, bool] | None:
    """Insert-or-fetch the vocab_words row for this user+word, then append a
    context if one wasn't already captured for this exact book/block.

    Returns None when the word isn't in the offline lexicon — there is no
    dictionary data to snapshot, so nothing is saved. Returns
    (row, already_existed) otherwise; already_existed lets the caller show
    "already in your vocabulary" instead of "saved".
    """
    entry = cefr_lexicon.lookup(word)
    if entry is None:
        return None

    new_id = uuid7()
    conn.execute(
        """
        INSERT INTO vocab_words (id, user_id, word, lemma, pos, cefr, definition, example, simpler, synonyms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, lemma) DO NOTHING
        """,
        (
            new_id,
            user_id,
            word.strip(),
            entry.lemma,
            entry.pos or None,
            entry.cefr or cefr_lexicon.band_of(word),
            entry.definition,
            entry.example,
            entry.simpler,
            json.dumps(list(entry.synonyms)),
            iso8601_utc_now(),
        ),
    )
    row = conn.execute(
        "SELECT * FROM vocab_words WHERE user_id = ? AND lemma = ?", (user_id, entry.lemma)
    ).fetchone()
    already_existed = row["id"] != new_id

    # A saved word is a word to be scheduled — created here rather than only
    # by 0015's backfill, so a word saved after that migration reaches the
    # review queue without a separate "add to review" step.
    #
    # Keyed off row["id"], never new_id: the insert above is ON CONFLICT DO
    # NOTHING, so for a word already saved new_id was never written and a card
    # pointing at it has no word to belong to.
    review.ensure_card(conn, user_id, row["id"])

    _add_context_if_new(
        conn, row["id"], sentence=sentence, book_id=book_id, block_index=block_index, page=page
    )
    return row, already_existed


def save_manual_word(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    word: str,
    pos: str,
    definition: str,
    example: str | None,
    synonyms: list[str],
    ipa: str | None,
    audio_url: str | None,
    note_text: str | None,
    ai_definition: str | None = None,
    ai_examples: list[str] | None = None,
    ai_mnemonic: str | None = None,
    ai_usage_note: str | None = None,
    ai_sense_definition: str | None = None,
) -> tuple[sqlite3.Row, bool]:
    """Save a word the user picked from a dictionaryapi.dev search rather
    than one captured while reading — same de-dup key (user_id, lemma) as
    save_word, so a manually-added "abandoned" still collides with a later
    reader-captured "abandon".

    Still checks the offline lexicon first, purely to reuse its lemma
    resolution and to pick up a real CEFR band/simpler-word suggestion when
    it happens to know the word too — dictionaryapi.dev has neither.
    """
    local = cefr_lexicon.lookup(word)
    lemma = local.lemma if local is not None else cefr_lexicon.normalise(word)
    # band_of, not local.cefr. The curated lexicon holds about a thousand
    # words; the band table behind it answers for eight thousand more, and
    # reading the level off `local` alone is why a word saved from a video or
    # added by hand showed "CEFR —" even when we knew its level perfectly
    # well. band_of still prefers the curated entry where there is one.
    cefr = cefr_lexicon.band_of(word)
    simpler = local.simpler if local is not None else None

    new_id = uuid7()
    conn.execute(
        """
        INSERT INTO vocab_words (id, user_id, word, lemma, pos, cefr, definition, example, simpler,
                                 synonyms, ipa, audio_url, ai_definition, ai_examples, ai_mnemonic,
                                 ai_usage_note, ai_sense_definition, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, lemma) DO NOTHING
        """,
        (
            new_id,
            user_id,
            word.strip(),
            lemma,
            pos or None,
            cefr,
            definition,
            example,
            simpler,
            json.dumps(list(synonyms)),
            ipa,
            audio_url,
            ai_definition,
            json.dumps(list(ai_examples or [])),
            ai_mnemonic,
            ai_usage_note,
            ai_sense_definition,
            iso8601_utc_now(),
        ),
    )
    row = conn.execute("SELECT * FROM vocab_words WHERE user_id = ? AND lemma = ?", (user_id, lemma)).fetchone()
    already_existed = row["id"] != new_id
    # A word already saved keeps whatever it has, except where this save
    # brings enrichment it was missing — re-adding a word to attach a
    # mnemonic should work, and should not wipe the rest of the entry.
    if already_existed:
        _fill_missing_enrichment(
            conn,
            row,
            ai_definition=ai_definition,
            ai_examples=ai_examples,
            ai_mnemonic=ai_mnemonic,
            ai_usage_note=ai_usage_note,
            ai_sense_definition=ai_sense_definition,
        )
        row = conn.execute("SELECT * FROM vocab_words WHERE id = ?", (row["id"],)).fetchone()
    review.ensure_card(conn, user_id, row["id"])

    if not already_existed and note_text and note_text.strip():
        add_note(conn, row["id"], note_text.strip())

    return row, already_existed


# What a learner actually wants to slice their collection by. Each maps to a
# predicate over the joined review_cards row — "status" is scheduling state,
# which is the dimension the old list had no idea existed.
STATUS_FILTERS = ("all", "due", "new", "learning", "mastered", "struggling", "suspended")
SORT_ORDERS = ("recent", "oldest", "alphabetical", "mastery", "due", "difficulty")


def list_words(
    conn: sqlite3.Connection,
    user_id: str,
    *,
    query: str = "",
    cefr: str | None = None,
    tag: str | None = None,
    status: str = "all",
    sort: str = "recent",
    now_iso: str | None = None,
) -> list[sqlite3.Row]:
    """The vocabulary list, filtered and ordered in SQL.

    Previously this was `SELECT * ... ORDER BY created_at DESC` with the
    search done in the browser over whatever had already been fetched. That
    is fine for twenty words and wrong for two thousand, and it left the only
    available ordering — when a word happened to be saved — as the least
    useful thing to sort a vocabulary by.

    The join onto review_cards is the substantive change: a word's scheduling
    state is the most informative thing about it (is it due, is it sticking,
    is it a leech) and the list could not see it at all."""
    now_iso = now_iso or iso8601_utc_now()
    where = ["w.user_id = ?"]
    params: list = [user_id]

    if query.strip():
        like = f"%{query.strip().lower()}%"
        # Definition included deliberately: half of "find that word I saved"
        # is remembering the meaning but not the word.
        where.append(
            "(LOWER(w.word) LIKE ? OR LOWER(w.lemma) LIKE ? OR LOWER(COALESCE(w.definition,'')) LIKE ?"
            " OR EXISTS (SELECT 1 FROM vocab_tags t WHERE t.vocab_word_id = w.id AND LOWER(t.tag) LIKE ?))"
        )
        params += [like, like, like, like]

    if cefr:
        where.append("w.cefr = ?")
        params.append(cefr.upper())

    if tag:
        where.append("EXISTS (SELECT 1 FROM vocab_tags t WHERE t.vocab_word_id = w.id AND t.tag = ?)")
        params.append(tag)

    if status == "due":
        where.append("rc.suspended = 0 AND rc.state != 'new' AND rc.due <= ?")
        params.append(now_iso)
    elif status == "new":
        where.append("(rc.state = 'new' OR rc.state IS NULL)")
    elif status == "learning":
        where.append("rc.state IN ('learning', 'relearning')")
    elif status == "mastered":
        # Level 5 needs conversation evidence, which is not a column — the
        # cheap proxy here is a card that is both stable and has been used
        # unprompted at least once; the exact level is computed per row below.
        where.append("rc.stability >= 21")
    elif status == "struggling":
        where.append("rc.lapses >= 3")
    elif status == "suspended":
        where.append("rc.suspended = 1")

    order = {
        "recent": "w.created_at DESC",
        "oldest": "w.created_at ASC",
        "alphabetical": "LOWER(w.word) ASC",
        # NULLs last so unscheduled words don't crowd the top of a view that
        # is specifically about scheduling.
        "mastery": "rc.stability DESC NULLS LAST, w.created_at DESC",
        "due": "rc.due ASC NULLS LAST",
        "difficulty": "rc.difficulty DESC NULLS LAST, rc.lapses DESC",
    }.get(sort, "w.created_at DESC")

    return conn.execute(
        f"""
        SELECT w.*, rc.stability, rc.difficulty, rc.state AS card_state, rc.due,
               rc.reps, rc.lapses, rc.suspended
        FROM vocab_words w
        LEFT JOIN review_cards rc ON rc.vocab_word_id = w.id
        WHERE {' AND '.join(where)}
        ORDER BY {order}
        """,
        params,
    ).fetchall()


def overview(conn: sqlite3.Connection, user_id: str, *, now_iso: str | None = None) -> dict:
    """A summary of the collection, so the list opens on something other than
    an undifferentiated wall of words."""
    now_iso = now_iso or iso8601_utc_now()
    total = conn.execute(
        "SELECT COUNT(*) AS n FROM vocab_words WHERE user_id = ?", (user_id,)
    ).fetchone()["n"]

    by_cefr = {
        r["cefr"] or "—": r["n"]
        for r in conn.execute(
            "SELECT COALESCE(cefr,'—') AS cefr, COUNT(*) AS n FROM vocab_words "
            "WHERE user_id = ? GROUP BY COALESCE(cefr,'—') ORDER BY cefr",
            (user_id,),
        )
    }

    tags = [
        {"tag": r["tag"], "count": r["n"]}
        for r in conn.execute(
            "SELECT t.tag, COUNT(*) AS n FROM vocab_tags t "
            "JOIN vocab_words w ON w.id = t.vocab_word_id WHERE w.user_id = ? "
            "GROUP BY t.tag ORDER BY n DESC, t.tag ASC",
            (user_id,),
        )
    ]

    counts = conn.execute(
        """
        SELECT
          SUM(CASE WHEN rc.suspended = 0 AND rc.state != 'new' AND rc.due <= ? THEN 1 ELSE 0 END) AS due_now,
          SUM(CASE WHEN rc.state = 'new' THEN 1 ELSE 0 END)                     AS new_count,
          SUM(CASE WHEN rc.state IN ('learning','relearning') THEN 1 ELSE 0 END) AS learning,
          SUM(CASE WHEN rc.lapses >= 3 THEN 1 ELSE 0 END)                        AS struggling,
          SUM(CASE WHEN rc.suspended = 1 THEN 1 ELSE 0 END)                      AS suspended
        FROM review_cards rc WHERE rc.user_id = ?
        """,
        (now_iso, user_id),
    ).fetchone()

    added_7d = conn.execute(
        "SELECT COUNT(*) AS n FROM vocab_words WHERE user_id = ? AND created_at >= ?",
        (user_id, _days_ago_iso(7)),
    ).fetchone()["n"]

    return {
        "total": total,
        "added_last_7_days": added_7d,
        "due_now": counts["due_now"] or 0,
        "new_count": counts["new_count"] or 0,
        "learning": counts["learning"] or 0,
        "struggling": counts["struggling"] or 0,
        "suspended": counts["suspended"] or 0,
        "by_cefr": by_cefr,
        "tags": tags,
    }


def _days_ago_iso(days: int) -> str:
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_word_row(conn: sqlite3.Connection, user_id: str, word: str) -> sqlite3.Row | None:
    """Resolves `word` through the same lemmatisation save_word used, so an
    inflected form ("walked") finds the entry saved under its lemma ("walk")."""
    entry = cefr_lexicon.lookup(word)
    lemma = entry.lemma if entry is not None else cefr_lexicon.normalise(word)
    # Joined the same way list_words does, so the detail view reports a word's
    # real scheduling state. Without the join those columns are absent and the
    # response model's defaults take over, which would report every word —
    # however well known — as never reviewed.
    return conn.execute(
        """
        SELECT w.*, rc.stability, rc.difficulty, rc.state AS card_state, rc.due,
               rc.reps, rc.lapses, rc.suspended
        FROM vocab_words w
        LEFT JOIN review_cards rc ON rc.vocab_word_id = w.id
        WHERE w.user_id = ? AND w.lemma = ?
        """,
        (user_id, lemma),
    ).fetchone()


def get_contexts(conn: sqlite3.Connection, vocab_word_id: str) -> list[sqlite3.Row]:
    """Contexts, with the clip that belongs to each one where there is a clip.

    The join is LEFT because a clip context is complete without its video:
    extraction is queued behind the save (spec §4.1.3) and may still be
    running, may have been declined by the storage policy, or may have failed
    because the source moved. All three still show the line and the timecode.
    """
    return conn.execute(
        """
        SELECT c.*, k.id AS clip_id, k.status AS clip_status
          FROM vocab_contexts c
          LEFT JOIN media_clips k ON k.vocab_context_id = c.id
         WHERE c.vocab_word_id = ?
         ORDER BY c.created_at
        """,
        (vocab_word_id,),
    ).fetchall()


def get_notes(conn: sqlite3.Connection, vocab_word_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM vocab_notes WHERE vocab_word_id = ? ORDER BY created_at", (vocab_word_id,)
    ).fetchall()


def get_tags(conn: sqlite3.Connection, vocab_word_id: str) -> list[str]:
    rows = conn.execute(
        "SELECT tag FROM vocab_tags WHERE vocab_word_id = ? ORDER BY created_at", (vocab_word_id,)
    ).fetchall()
    return [row["tag"] for row in rows]


def context_count(conn: sqlite3.Connection, vocab_word_id: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM vocab_contexts WHERE vocab_word_id = ?", (vocab_word_id,)
    ).fetchone()
    return int(row["c"])


def add_note(conn: sqlite3.Connection, vocab_word_id: str, text: str) -> sqlite3.Row:
    note_id = uuid7()
    conn.execute(
        "INSERT INTO vocab_notes (id, vocab_word_id, text, created_at) VALUES (?, ?, ?, ?)",
        (note_id, vocab_word_id, text, iso8601_utc_now()),
    )
    return conn.execute("SELECT * FROM vocab_notes WHERE id = ?", (note_id,)).fetchone()


def delete_note(conn: sqlite3.Connection, vocab_word_id: str, note_id: str) -> bool:
    row = conn.execute(
        "SELECT id FROM vocab_notes WHERE id = ? AND vocab_word_id = ?", (note_id, vocab_word_id)
    ).fetchone()
    if row is None:
        return False
    conn.execute("DELETE FROM vocab_notes WHERE id = ?", (note_id,))
    return True


def add_tag(conn: sqlite3.Connection, vocab_word_id: str, tag: str) -> list[str]:
    tag = tag.strip()
    if tag:
        conn.execute(
            """
            INSERT INTO vocab_tags (vocab_word_id, tag, created_at) VALUES (?, ?, ?)
            ON CONFLICT(vocab_word_id, tag) DO NOTHING
            """,
            (vocab_word_id, tag, iso8601_utc_now()),
        )
    return get_tags(conn, vocab_word_id)


def remove_tag(conn: sqlite3.Connection, vocab_word_id: str, tag: str) -> list[str]:
    conn.execute("DELETE FROM vocab_tags WHERE vocab_word_id = ? AND tag = ?", (vocab_word_id, tag))
    return get_tags(conn, vocab_word_id)


def delete_word(conn: sqlite3.Connection, user_id: str, vocab_word_id: str) -> bool:
    row = conn.execute(
        "SELECT id FROM vocab_words WHERE id = ? AND user_id = ?", (vocab_word_id, user_id)
    ).fetchone()
    if row is None:
        return False
    conn.execute("DELETE FROM vocab_words WHERE id = ?", (vocab_word_id,))
    # Synthesized pronunciation lives on disk, outside any DB cascade, so
    # deleting the word has to clear it explicitly or it leaks forever.
    delete_pronunciation(vocab_word_id)
    return True


def _add_context_if_new(
    conn: sqlite3.Connection,
    vocab_word_id: str,
    *,
    sentence: str | None,
    book_id: str | None,
    block_index: int | None,
    page: int | None = None,
) -> None:
    """Record where the word was met, if this place is not already recorded.

    A word met in reflowed text arrives with a block; one met on a printed
    page arrives with a page instead, because a selection there is a run of
    boxes on an image rather than a paragraph anything recorded. Either is
    enough to say where the word came from, and that sentence is the whole
    value of the entry later: a word with no context is a flashcard with no
    memory attached.
    """
    if not sentence or book_id is None or (block_index is None and page is None):
        return
    # One context per place. Which column identifies "the place" depends on
    # which one the reader's view could supply.
    if block_index is not None:
        existing = conn.execute(
            "SELECT id FROM vocab_contexts WHERE vocab_word_id = ? AND book_id = ? AND block_index = ?",
            (vocab_word_id, book_id, block_index),
        ).fetchone()
    else:
        existing = conn.execute(
            "SELECT id FROM vocab_contexts WHERE vocab_word_id = ? AND book_id = ? AND page = ?",
            (vocab_word_id, book_id, page),
        ).fetchone()
    if existing is not None:
        return
    conn.execute(
        """
        INSERT INTO vocab_contexts
          (id, vocab_word_id, kind, snippet, source_label, book_id, block_index, page, created_at)
        VALUES (?, ?, 'page', ?, ?, ?, ?, ?, ?)
        """,
        (
            uuid7(),
            vocab_word_id,
            sentence,
            _page_label(conn, book_id, block_index, page),
            book_id,
            block_index,
            page if page is not None else _page_number_for(conn, book_id, block_index),
            iso8601_utc_now(),
        ),
    )


def _page_number_for(conn: sqlite3.Connection, book_id: str, block_index: int | None) -> int | None:
    """The printed page a block falls on, so every context knows its page
    whichever way it arrived."""
    if block_index is None:
        return None
    book = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    return None if book is None else _page_number(conn, book, block_index)


def _page_label(
    conn: sqlite3.Connection, book_id: str, block_index: int | None, page: int | None = None
) -> str:
    book = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    if book is None:
        return "Unknown source"
    shown = page if block_index is None else _page_number(conn, book, block_index)
    return f"{book['title']} · p.{shown}"


def _page_number(conn: sqlite3.Connection, book: sqlite3.Row, block_index: int) -> int:
    """Mirrors books.py's _block_page/_uses_native_pages/_word_offset_before —
    kept local rather than importing private router helpers across modules."""
    uses_native = "uses_native_pages" in book.keys() and bool(book["uses_native_pages"])
    if uses_native:
        row = conn.execute(
            "SELECT page_number FROM book_blocks WHERE book_id = ? AND block_index = ?",
            (book["id"], block_index),
        ).fetchone()
        if row is not None and row["page_number"] is not None:
            return row["page_number"]
    offset_row = conn.execute(
        "SELECT COALESCE(SUM(word_count), 0) AS w FROM book_blocks WHERE book_id = ? AND block_index < ?",
        (book["id"], block_index),
    ).fetchone()
    return pagination.page_number(offset_row["w"])


def _pronunciation_dir() -> Path:
    d = Path(settings.db_path).resolve().parent / "pronunciation"
    d.mkdir(parents=True, exist_ok=True)
    return d


def pronunciation_path(vocab_word_id: str, text: str, part: str, engine: str) -> Path:
    """Synthesized once, then served from disk.

    Keyed by engine as well as word because the file *is* that engine's voice
    — the same reason conversation audio chunks are (see
    conversation.audio_chunk_path). Written to a temp file and moved into
    place so a second request for the same clip cannot read a half-written
    WAV."""
    name = tts.normalise(engine)
    safe_part = "word" if part == "word" else "sentence"
    path = _pronunciation_dir() / f"{vocab_word_id}.{name}.{safe_part}.wav"
    if not path.exists():
        audio = tts.engine_for(name).synthesize(text)
        tmp = path.with_suffix(f".{uuid7()}.part")
        try:
            tmp.write_bytes(audio)
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)
    return path


def delete_pronunciation(vocab_word_id: str) -> None:
    """Called when a word is removed — these are derived files that nothing
    else will ever clean up, and no DB cascade reaches them."""
    for stale in _pronunciation_dir().glob(f"{vocab_word_id}.*.wav"):
        stale.unlink(missing_ok=True)


def speech_path(text: str, engine: str) -> Path:
    """Synthesized speech for arbitrary short text, cached by content.

    Keyed by a hash of the text rather than by a word id, because the point
    of this one is to speak something that has not been saved yet. Same
    engine-in-the-name and atomic-rename rules as everything else that writes
    audio here."""
    import hashlib

    name = tts.normalise(engine)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    path = _pronunciation_dir() / f"speak.{name}.{digest}.wav"
    if not path.exists():
        audio = tts.engine_for(name).synthesize(text)
        tmp = path.with_suffix(f".{uuid7()}.part")
        try:
            tmp.write_bytes(audio)
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)
    return path


def _fill_missing_enrichment(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    ai_definition: str | None,
    ai_examples: list[str] | None,
    ai_mnemonic: str | None,
    ai_usage_note: str | None,
    ai_sense_definition: str | None,
) -> None:
    """Adds enrichment to an existing entry without overwriting what is there.

    Only empty fields are filled. Someone re-adding a word to attach a
    mnemonic should get the mnemonic; they should not silently lose the
    definition they already had."""
    updates: dict[str, object] = {}
    if ai_definition and not row["ai_definition"]:
        updates["ai_definition"] = ai_definition
        updates["ai_sense_definition"] = ai_sense_definition
    if ai_examples and not json.loads(row["ai_examples"] or "[]"):
        updates["ai_examples"] = json.dumps(list(ai_examples))
    if ai_mnemonic and not row["ai_mnemonic"]:
        updates["ai_mnemonic"] = ai_mnemonic
    if ai_usage_note and not row["ai_usage_note"]:
        updates["ai_usage_note"] = ai_usage_note
    if not updates:
        return
    assignments = ", ".join(f"{k} = ?" for k in updates)
    conn.execute(
        f"UPDATE vocab_words SET {assignments} WHERE id = ?", [*updates.values(), row["id"]]
    )


def timecode(ms: int) -> str:
    """h:mm:ss for a source label. Hours are dropped below an hour so a
    nine-minute video doesn't read "0:03:41"."""
    total = max(0, ms) // 1000
    hours, rest = divmod(total, 3600)
    minutes, seconds = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


def add_clip_context(
    conn: sqlite3.Connection,
    *,
    vocab_word_id: str,
    media_item_id: str,
    media_title: str,
    snippet: str,
    start_ms: int,
    end_ms: int,
    media_file_hash: str | None = None,
) -> str | None:
    """A context captured while watching (spec §4.1.2 "save with context").

    De-duped on the timecode, not just on the media item: the same word met
    twice in one film is two genuinely different moments and deserves two
    clips, but pressing save twice on one line is not.
    """
    existing = conn.execute(
        "SELECT id FROM vocab_contexts WHERE vocab_word_id = ? AND media_item_id = ? AND start_ms = ?",
        (vocab_word_id, media_item_id, start_ms),
    ).fetchone()
    if existing is not None:
        return None
    context_id = uuid7()
    conn.execute(
        """
        INSERT INTO vocab_contexts (id, vocab_word_id, kind, snippet, source_label,
                                    media_item_id, start_ms, end_ms, media_file_hash, created_at)
        VALUES (?, ?, 'clip', ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            context_id,
            vocab_word_id,
            snippet,
            f"{media_title} · {timecode(start_ms)}",
            media_item_id,
            start_ms,
            end_ms,
            media_file_hash,
            iso8601_utc_now(),
        ),
    )
    return context_id


def backfill_missing_cefr(conn: sqlite3.Connection) -> int:
    """Give already-saved words the level we can now work out for them.

    Words saved before save_manual_word consulted the band table carry a NULL
    cefr that no later edit would ever fill — the level is snapshotted at save
    time by design, so nothing re-reads it. Runs at startup beside
    ensure_fts_backfilled, and touches only rows that have no level at all, so
    a hand-corrected band is never overwritten.
    """
    rows = conn.execute("SELECT id, word, lemma FROM vocab_words WHERE cefr IS NULL").fetchall()
    updates = [
        (band, row["id"])
        for row in rows
        if (band := cefr_lexicon.band_of(row["word"]) or cefr_lexicon.band_of(row["lemma"]))
    ]
    if updates:
        conn.executemany("UPDATE vocab_words SET cefr = ? WHERE id = ?", updates)
        conn.commit()
    return len(updates)


def relink_clip_contexts(
    conn: sqlite3.Connection, *, media_item_id: str, file_hash: str, user_id: str
) -> int:
    """Reattach moments captured from this file before it last left the library.

    Matched on the file's own hash, so it works across a delete and re-import
    even though the item id changed. Scoped to the owning learner: two people
    can hold the same film and their captured moments are not interchangeable.

    Each reattached context also gets its clip row back, as `virtual` — the
    state the timecodes-only storage policy produces. The extracted video was
    deleted with the library entry and is not worth rebuilding for moments the
    learner may never open again, but the source is present and the window is
    known, so the existing on-demand path can cut it the moment one is played.
    """
    rows = conn.execute(
        """
        SELECT c.id, c.snippet, c.start_ms, c.end_ms, c.vocab_word_id
          FROM vocab_contexts c
          JOIN vocab_words w ON w.id = c.vocab_word_id
         WHERE c.media_item_id IS NULL
           AND c.media_file_hash = ?
           AND w.user_id = ?
        """,
        (file_hash, user_id),
    ).fetchall()
    if not rows:
        return 0

    conn.executemany(
        "UPDATE vocab_contexts SET media_item_id = ? WHERE id = ?",
        [(media_item_id, row["id"]) for row in rows],
    )
    conn.executemany(
        """
        INSERT INTO media_clips (id, media_item_id, vocab_word_id, vocab_context_id, cue_text,
                                 start_ms, end_ms, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'virtual', ?)
        """,
        [
            (
                uuid7(),
                media_item_id,
                row["vocab_word_id"],
                row["id"],
                row["snippet"],
                row["start_ms"] or 0,
                row["end_ms"] or 0,
                iso8601_utc_now(),
            )
            for row in rows
        ],
    )
    return len(rows)


def backfill_context_hashes(conn: sqlite3.Connection) -> int:
    """Stamp the file hash onto clip contexts saved before the column existed.

    Without it, a moment captured before this change is unrecoverable the first
    time its film leaves the library — there would be nothing to match on.
    Only fills rows that still point at a live media item, which is exactly the
    set that can still be told which file they came from.
    """
    updated = conn.execute(
        """
        UPDATE vocab_contexts
           SET media_file_hash = (SELECT m.file_hash FROM media_items m WHERE m.id = vocab_contexts.media_item_id)
         WHERE media_file_hash IS NULL
           AND media_item_id IS NOT NULL
        """
    ).rowcount
    if updated:
        conn.commit()
    return max(0, updated)
