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
    LevelTextRequest,
    BlockHeatOut,
    GoalDayOut,
    GoalUpdate,
    HeatOut,
    HeatSpanOut,
    LeveledSegmentOut,
    LeveledTextOut,
    LevelRequest,
    ReaderPrefsOut,
    ReaderPrefsUpdate,
    ReadingStatsOut,
    SubstitutionOut,
    WordLookupOut,
    WordSenseOut,
)
from app.security import require_token
from app.services import (
    cefr_lexicon,
    dictionary,
    difficulty_heat,
    leveling,
    pronunciation,
    reader_level,
    reading_goal,
)
from app.services.ingest.pipeline import normalise_text_hash
from app.services.leveling import cache as level_cache
from app.utils.time import local_date_today

router = APIRouter(prefix="/reading", dependencies=[Depends(require_token)])



def _stats(conn: sqlite3.Connection, user_id: str) -> ReadingStatsOut:
    goal = reading_goal.get_daily_goal(conn, user_id)
    today = local_date_today()
    pages_today = reading_goal.pages_on(conn, user_id, today)
    return ReadingStatsOut(
        goal_pages=goal,
        pages_today=pages_today,
        books_today=reading_goal.books_read_on(conn, user_id, today),
        streak_days=reading_goal.streak_days(conn, user_id, goal),
        goal_met=pages_today >= goal,
        week=[
            GoalDayOut(
                date=day,
                label=label,
                pages=pages,
                percent=min(100, round(pages / goal * 100)) if goal > 0 else 0,
            )
            for day, label, pages in reading_goal.week_pages(conn, user_id)
        ],
    )


@router.get("/stats", response_model=ReadingStatsOut)
def get_stats(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ReadingStatsOut:
    return _stats(conn, user_id)


@router.put("/goal", response_model=ReadingStatsOut)
def update_goal(payload: GoalUpdate, conn: sqlite3.Connection = Depends(get_db)) -> ReadingStatsOut:
    """Returns the recomputed stats, not just the goal — changing the target
    also changes whether today counts and how long the streak is."""
    reading_goal.set_daily_goal(conn, payload.user_id, payload.daily_page_goal)
    return _stats(conn, payload.user_id)


def _resolve_target_cefr(
    conn: sqlite3.Connection, user_id: str | None, requested: str | None
) -> str:
    """The reader's target band, as an HTTP concern: see reader_level."""
    try:
        return reader_level.resolve_target(conn, user_id, requested)
    except reader_level.UnknownBand as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


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
    """The AI panel's dictionary payload.

    Nearest source first: the bundled lexicon, then whatever this machine has
    already looked up, and only then the network. Clicking a word in a book
    used to consult the bundled list alone, which carries definitions for a
    few hundred words — so nearly every word in a real novel came back "not
    in the dictionary" while an answer was a second away.

    The CEFR band and the simpler synonym still come from the lexicon
    whatever answered, because no online dictionary has them.

    `ctx` (the sentence the word appeared in) is accepted now so the client
    contract doesn't change when contextual explanation lands in Phase 7 —
    today it only confirms the word really occurs in that sentence.
    """
    word = (w or "").strip()
    if not word:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="w is required")

    entry = cefr_lexicon.lookup(word)
    try:
        answer = dictionary.look_up(conn, word)
    except dictionary.DictionaryServiceUnavailable:
        # Reading is an offline activity and must stay one. A dictionary that
        # cannot be reached falls back to whatever the lexicon knows rather
        # than turning a click on a word into an error.
        answer = None

    senses: list[WordSenseOut] = []
    synonyms: list[str] = []
    ipa: str | None = None
    if answer is not None and answer.result.found:
        senses = [
            WordSenseOut(definition=sense.definition, example=sense.example)
            for sense in answer.result.senses
            if sense.definition
        ]
        synonyms = list(answer.result.synonyms)
        ipa = answer.result.ipa
    elif entry is not None and entry.definition:
        senses = [WordSenseOut(definition=entry.definition, example=entry.example)]
        synonyms = list(entry.synonyms)

    if not senses and entry is None:
        return WordLookupOut(
            word=word,
            lemma=None,
            pos=None,
            cefr=cefr_lexicon.band_of(word),
            ipa=pronunciation.display(pronunciation.ipa_for(word)),
            senses=[],
            synonyms=[],
            simpler=None,
            found=False,
            context_available=False,
            context_note=None,
        )

    return WordLookupOut(
        word=word,
        lemma=entry.lemma if entry is not None else None,
        pos=(entry.pos or None) if entry is not None else None,
        # band_of covers the ~8.8k-word band table, not just the curated list.
        cefr=(entry.cefr if entry is not None else None) or cefr_lexicon.band_of(word),
        # CMUdict, offline, for 126k words — used whenever the source that
        # answered had no phonetics of its own.
        ipa=pronunciation.display(ipa or pronunciation.ipa_for(word)),
        senses=senses,
        synonyms=synonyms,
        simpler=entry.simpler if entry is not None else None,
        found=bool(senses),
        # Needs generation (Phase 7); never faked.
        context_available=False,
        context_note=None,
    )


def _to_out(result: leveling.LeveledText, *, cached: bool, requested_mode: str) -> LeveledTextOut:
    return LeveledTextOut(
        mode=requested_mode,
        served_mode=result.mode,
        target_cefr=result.target_cefr,
        engine=result.engine,
        original=result.original,
        segments=[LeveledSegmentOut(text=s.text, original=s.original) for s in result.segments],
        substitutions=[
            SubstitutionOut(from_text=original, to_text=replacement)
            for original, replacement in result.substitutions
        ],
        available=result.available,
        note=result.note,
        cached=cached,
    )


def _block_for_leveling(conn: sqlite3.Connection, book_id: str, block_index: int):
    row = conn.execute(
        "SELECT text, text_hash FROM book_blocks WHERE book_id = ? AND block_index = ?",
        (book_id, block_index),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Block not found")
    return row


@router.post("/level", response_model=LeveledTextOut)
def level_block(
    payload: LevelRequest, conn: sqlite3.Connection = Depends(get_db)
) -> LeveledTextOut:
    """Cache-first leveling of one block (spec §7.3).

    Deliberately one block per call: pre-leveling a whole book would be ~800
    generations for text the reader may never open, and the panel's own copy
    already promises "applies to the selection only".
    """
    if payload.mode not in leveling.MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"mode must be one of {', '.join(leveling.MODES)}",
        )

    row = _block_for_leveling(conn, payload.book_id, payload.block_index)
    target = _resolve_target_cefr(conn, payload.user_id, payload.target_cefr)
    mode = payload.mode

    if mode in leveling.RULES_MODES:
        result, cached = level_cache.get_or_generate(
            conn,
            text=row["text"],
            text_hash=row["text_hash"],
            mode=mode,
            target_cefr=target,
            engine=leveling.rules,
        )
        return _to_out(result, cached=cached, requested_mode=mode)

    engine = leveling.LlmEngine(
        leveling.configured_model(conn, payload.user_id), conn=conn, user_id=payload.user_id
    )
    try:
        result, cached = level_cache.get_or_generate(
            conn,
            text=row["text"],
            text_hash=row["text_hash"],
            mode=mode,
            target_cefr=target,
            engine=engine,
        )
        return _to_out(result, cached=cached, requested_mode=mode)
    except leveling.EngineUnavailable as exc:
        return _unavailable(conn, row, mode=mode, target=target, reason=str(exc))


#: A selection longer than this is a page, not a passage — and a local
#: model asked for a page takes minutes and returns something worse.
_MAX_LEVEL_TEXT = 1200


@router.post("/level-text", response_model=LeveledTextOut)
def level_text(payload: LevelTextRequest, conn: sqlite3.Connection = Depends(get_db)) -> LeveledTextOut:
    """Simplify a passage the reader selected on the page.

    Same engines, same cache, same modes as /level — the only difference is
    where the text came from. A selection on a rendered page is not a block:
    it can cross block boundaries, and it can cover a caption, a table cell or
    an equation that the text extractor never recorded, which is exactly the
    material a reader is most likely to want put in plainer words.

    Keyed on the text itself, so two readers selecting the same sentence in
    the same book share one generation, and so does the same reader coming
    back to it.
    """
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="There is no text to simplify."
        )
    if len(text) > _MAX_LEVEL_TEXT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That is too much text to put in simpler words at once — "
            "try a sentence or two.",
        )
    if payload.mode not in leveling.MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"mode must be one of {', '.join(leveling.MODES)}",
        )

    target = _resolve_target_cefr(conn, payload.user_id, payload.target_cefr)
    text_hash = normalise_text_hash(text)
    # A stand-in for the block row the fallback path expects, carrying the
    # only two fields it reads.
    row = {"text": text, "text_hash": text_hash}

    if payload.mode in leveling.RULES_MODES:
        if payload.require_model:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Simpler wording is written by the AI. Ask for one of the rewrites.",
            )
        result, cached = level_cache.get_or_generate(
            conn,
            text=text,
            text_hash=text_hash,
            mode=payload.mode,
            target_cefr=target,
            engine=leveling.rules,
        )
        return _to_out(result, cached=cached, requested_mode=payload.mode)

    engine = leveling.LlmEngine(
        leveling.configured_model(conn, payload.user_id), conn=conn, user_id=payload.user_id
    )
    try:
        result, cached = level_cache.get_or_generate(
            conn,
            text=text,
            text_hash=text_hash,
            mode=payload.mode,
            target_cefr=target,
            engine=engine,
        )
        return _to_out(result, cached=cached, requested_mode=payload.mode)
    except leveling.EngineUnavailable as exc:
        # The caller that writes over the page would rather be told than be
        # handed something else — and 503 is the answer the app already knows
        # how to offer to start the AI from.
        if payload.require_model:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
            ) from exc
        return _unavailable(conn, row, mode=payload.mode, target=target, reason=str(exc))


def _unavailable(
    conn: sqlite3.Connection, row, *, mode: str, target: str, reason: str
) -> LeveledTextOut:
    """A generative mode with no model behind it.

    `contextual` degrades to the inline rewrite with a visible note — some
    simplification beats none. `semantic` is a plain-meaning gloss with no
    rules equivalent at all, so it returns nothing and says why rather than
    handing back the original text dressed up as a result.
    """
    if mode == "contextual":
        fallback, cached = level_cache.get_or_generate(
            conn,
            text=row["text"],
            text_hash=row["text_hash"],
            mode="inline",
            target_cefr=target,
            engine=leveling.rules,
        )
        degraded = leveling.LeveledText(
            mode=fallback.mode,
            target_cefr=fallback.target_cefr,
            engine=fallback.engine,
            original=fallback.original,
            segments=fallback.segments,
            available=False,
            note=f"{reason} Showing the inline simplification instead.",
        )
        return _to_out(degraded, cached=cached, requested_mode=mode)

    return _to_out(
        leveling.LeveledText(
            mode=mode,
            target_cefr=target,
            engine="unavailable",
            original=row["text"],
            segments=(),
            available=False,
            note=reason,
        ),
        cached=False,
        requested_mode=mode,
    )


DEFAULT_PREFS = ReaderPrefsOut(
    font_size=15.5, page_theme="auto", heat_on=True, panel_open=True, panel_tab="toc"
)


@router.get("/prefs", response_model=ReaderPrefsOut)
def get_reader_prefs(
    user_id: str, conn: sqlite3.Connection = Depends(get_db)
) -> ReaderPrefsOut:
    """Reader display preferences (spec Phase 2 step 5).

    A reader who has never opened a book has no settings row yet, which is not
    an error — they get the same defaults the panel is built around.
    """
    row = conn.execute(
        """
        SELECT reader_font_size, reader_page_theme, reader_heat_on,
               reader_panel_open, reader_panel_tab, reader_page_view,
               reader_page_scroll, reader_page_zoom
        FROM user_settings WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()
    if row is None:
        return DEFAULT_PREFS
    return ReaderPrefsOut(
        font_size=row["reader_font_size"],
        page_theme=row["reader_page_theme"],
        heat_on=bool(row["reader_heat_on"]),
        panel_open=bool(row["reader_panel_open"]),
        panel_tab=row["reader_panel_tab"],
        page_view=bool(row["reader_page_view"]),
        page_scroll=row["reader_page_scroll"],
        page_zoom=row["reader_page_zoom"],
    )


@router.put("/prefs", response_model=ReaderPrefsOut)
def update_reader_prefs(
    payload: ReaderPrefsUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> ReaderPrefsOut:
    """Upserts only the reader columns.

    Deliberately not PUT /users/{id}/settings, which rewrites the whole row
    from an onboarding payload — reusing it here would wipe the LLM config
    every time someone nudged the font size.
    """
    conn.execute(
        """
        INSERT INTO user_settings (
          user_id, reader_font_size, reader_page_theme, reader_heat_on,
          reader_panel_open, reader_panel_tab, reader_page_view,
          reader_page_scroll, reader_page_zoom
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          reader_font_size = excluded.reader_font_size,
          reader_page_theme = excluded.reader_page_theme,
          reader_heat_on = excluded.reader_heat_on,
          reader_panel_open = excluded.reader_panel_open,
          reader_panel_tab = excluded.reader_panel_tab,
          reader_page_view = excluded.reader_page_view,
          reader_page_scroll = excluded.reader_page_scroll,
          reader_page_zoom = excluded.reader_page_zoom
        """,
        (
            payload.user_id,
            payload.font_size,
            payload.page_theme,
            int(payload.heat_on),
            int(payload.panel_open),
            payload.panel_tab,
            int(payload.page_view),
            payload.page_scroll,
            payload.page_zoom,
        ),
    )
    return ReaderPrefsOut(
        font_size=payload.font_size,
        page_theme=payload.page_theme,
        heat_on=payload.heat_on,
        panel_open=payload.panel_open,
        panel_tab=payload.panel_tab,
        page_view=payload.page_view,
        page_scroll=payload.page_scroll,
        page_zoom=payload.page_zoom,
    )
