"""Saved vocabulary words (spec §5.1 — the vocabulary increment).

Dictionary fields are snapshotted from cefr_lexicon at save time rather than
re-looked-up on read (see the migration's comment for why). There is
deliberately no scheduling logic here — mastery/due/retention belong to a
later spaced-repetition increment and are not modelled at all rather than
being faked.
"""

import json
import sqlite3

from app.services import cefr_lexicon, pagination
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
            entry.cefr,
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

    _add_context_if_new(conn, row["id"], sentence=sentence, book_id=book_id, block_index=block_index)
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
    cefr = local.cefr if local is not None else None
    simpler = local.simpler if local is not None else None

    new_id = uuid7()
    conn.execute(
        """
        INSERT INTO vocab_words (id, user_id, word, lemma, pos, cefr, definition, example, simpler, synonyms, ipa, audio_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            iso8601_utc_now(),
        ),
    )
    row = conn.execute("SELECT * FROM vocab_words WHERE user_id = ? AND lemma = ?", (user_id, lemma)).fetchone()
    already_existed = row["id"] != new_id

    if not already_existed and note_text and note_text.strip():
        add_note(conn, row["id"], note_text.strip())

    return row, already_existed


def list_words(conn: sqlite3.Connection, user_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM vocab_words WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
    ).fetchall()


def get_word_row(conn: sqlite3.Connection, user_id: str, word: str) -> sqlite3.Row | None:
    """Resolves `word` through the same lemmatisation save_word used, so an
    inflected form ("walked") finds the entry saved under its lemma ("walk")."""
    entry = cefr_lexicon.lookup(word)
    lemma = entry.lemma if entry is not None else cefr_lexicon.normalise(word)
    return conn.execute(
        "SELECT * FROM vocab_words WHERE user_id = ? AND lemma = ?", (user_id, lemma)
    ).fetchone()


def get_contexts(conn: sqlite3.Connection, vocab_word_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM vocab_contexts WHERE vocab_word_id = ? ORDER BY created_at", (vocab_word_id,)
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
    return True


def _add_context_if_new(
    conn: sqlite3.Connection,
    vocab_word_id: str,
    *,
    sentence: str | None,
    book_id: str | None,
    block_index: int | None,
) -> None:
    if not sentence or book_id is None or block_index is None:
        return
    existing = conn.execute(
        "SELECT id FROM vocab_contexts WHERE vocab_word_id = ? AND book_id = ? AND block_index = ?",
        (vocab_word_id, book_id, block_index),
    ).fetchone()
    if existing is not None:
        return
    conn.execute(
        """
        INSERT INTO vocab_contexts (id, vocab_word_id, kind, snippet, source_label, book_id, block_index, created_at)
        VALUES (?, ?, 'page', ?, ?, ?, ?, ?)
        """,
        (uuid7(), vocab_word_id, sentence, _page_label(conn, book_id, block_index), book_id, block_index, iso8601_utc_now()),
    )


def _page_label(conn: sqlite3.Connection, book_id: str, block_index: int) -> str:
    book = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    if book is None:
        return "Unknown source"
    return f"{book['title']} · p.{_page_number(conn, book, block_index)}"


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
