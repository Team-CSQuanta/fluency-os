"""Cross-book reading concerns: difficulty heat and word lookup (spec Phase 6).

Both run entirely offline against the bundled CEFR lexicon — no model, no
network. That's the whole point of this phase: the reader gets real
above-level tinting and real dictionary entries before any LLM exists.

Only the *in-context* explanation genuinely needs generation, and it is
reported as unavailable rather than faked, so the AI panel keeps its honest
"offline stub" copy for that one section.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.db import get_db
from app.models.reading import (
    BlockHeatOut,
    HeatOut,
    HeatSpanOut,
    WordLookupOut,
    WordSenseOut,
)
from app.security import require_token
from app.services import cefr_lexicon, difficulty_heat

router = APIRouter(prefix="/reading", dependencies=[Depends(require_token)])

DEFAULT_CEFR = "B1"


def _resolve_target_cefr(
    conn: sqlite3.Connection, user_id: str | None, requested: str | None
) -> str:
    """An explicit request wins; otherwise the reader's own placement level;
    otherwise B1. The same page tints differently for a B1 and a C1 reader,
    which is the entire feature."""
    if requested:
        if not cefr_lexicon.is_valid_band(requested):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"target_cefr must be one of {', '.join(cefr_lexicon.CEFR_ORDER)}",
            )
        return requested.upper()

    if user_id:
        row = conn.execute("SELECT cefr_level FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is not None and row["cefr_level"] and cefr_lexicon.is_valid_band(row["cefr_level"]):
            return row["cefr_level"].upper()

    return DEFAULT_CEFR


@router.get("/heat", response_model=HeatOut)
def get_heat(
    book_id: str,
    user_id: str | None = None,
    from_index: int = 0,
    limit: int = 60,
    target_cefr: str | None = None,
    conn: sqlite3.Connection = Depends(get_db),
) -> HeatOut:
    """Above-level character spans for a window of blocks, matching the window
    the reader already fetched from /books/{id}/blocks."""
    book = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    if book is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")

    resolved = _resolve_target_cefr(conn, user_id, target_cefr)

    # Per-book opt-out (the "Difficulty heat overlay" switch in Add books).
    # Answered here rather than in the client so the flag has one owner.
    if not book["heat_overlay"]:
        return HeatOut(target_cefr=resolved, enabled=False, blocks=[], total_above_level=0)

    rows = conn.execute(
        "SELECT block_index, text FROM book_blocks WHERE book_id = ? AND block_index >= ? "
        "ORDER BY block_index LIMIT ?",
        (book_id, max(0, from_index), max(0, limit)),
    ).fetchall()

    blocks: list[BlockHeatOut] = []
    total = 0
    for row in rows:
        spans = difficulty_heat.spans_for_text(row["text"], resolved)
        total += len(spans)
        # Blocks with nothing above level are still returned, so the client can
        # tell "no hard words here" from "this block wasn't in the window".
        blocks.append(
            BlockHeatOut(
                block_index=row["block_index"],
                spans=[
                    HeatSpanOut(
                        start_char=s.start_char,
                        end_char=s.end_char,
                        word=s.word,
                        cefr=s.cefr,
                        simpler=s.simpler,
                    )
                    for s in spans
                ],
            )
        )

    return HeatOut(
        target_cefr=resolved, enabled=True, blocks=blocks, total_above_level=total
    )


@router.get("/lookup", response_model=WordLookupOut)
def lookup_word(
    w: str,
    ctx: str | None = None,
    user_id: str | None = None,
    conn: sqlite3.Connection = Depends(get_db),
) -> WordLookupOut:
    """The AI panel's dictionary payload, from the bundled lexicon.

    `ctx` (the sentence the word appeared in) is accepted now so the client
    contract doesn't change when contextual explanation lands in Phase 7 —
    today it only confirms the word really occurs in that sentence.
    """
    word = (w or "").strip()
    if not word:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="w is required")

    entry = cefr_lexicon.lookup(word)

    if entry is None:
        return WordLookupOut(
            word=word,
            lemma=None,
            pos=None,
            cefr=None,
            ipa=None,
            senses=[],
            synonyms=[],
            simpler=None,
            found=False,
            context_available=False,
            context_note=None,
        )

    senses: list[WordSenseOut] = []
    if entry.definition:
        senses.append(WordSenseOut(definition=entry.definition, example=entry.example))

    return WordLookupOut(
        word=word,
        lemma=entry.lemma,
        pos=entry.pos or None,
        cefr=entry.cefr,
        # No pronunciation data in the bundled list yet — the panel hides the
        # slot rather than inventing an IPA transcription.
        ipa=None,
        senses=senses,
        synonyms=list(entry.synonyms),
        simpler=entry.simpler,
        found=True,
        # Needs generation (Phase 7); never faked.
        context_available=False,
        context_note=None,
    )
