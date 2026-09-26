import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.db import get_db
from app.models.vocabulary import (
    AiExamplesOut,
    AiExplainIn,
    AiEnrichIn,
    AiEnrichOut,
    AiExplainOut,
    AiMnemonicOut,
    AiPracticeOut,
    DictionaryCacheOut,
    DictionarySearchOut,
    DictionarySenseOut,
    VocabContextOut,
    VocabNoteCreate,
    VocabNoteOut,
    VocabOverviewOut,
    VocabTagCreate,
    VocabWordCreate,
    VocabWordDetailOut,
    VocabWordManualCreate,
    VocabWordOut,
    VocabWordSaveOut,
)
from app.security import require_token
from app.services import (
    cefr_lexicon,
    conversation,
    dictionary,
    fsrs,
    pronunciation,
    review,
    vocabulary,
    vocabulary_ai,
)
from app.services.voice import tts
from app.services.voice.errors import EngineUnavailable

router = APIRouter(prefix="/vocabulary", dependencies=[Depends(require_token)])


def _row_to_word_out(conn: sqlite3.Connection, row: sqlite3.Row) -> VocabWordOut:
    return VocabWordOut(
        id=row["id"],
        user_id=row["user_id"],
        word=row["word"],
        lemma=row["lemma"],
        pos=row["pos"],
        # Falls back to the band table when the row has no level of its own.
        # Derived rather than backfilled: the stored value was snapshotted
        # when the word was saved, so a word added before the band table
        # existed would otherwise stay "—" forever, and would go stale again
        # the next time the lexicon grows.
        cefr=row["cefr"] or cefr_lexicon.band_of(row["word"]),
        definition=row["definition"],
        example=row["example"],
        simpler=row["simpler"],
        # Same fallback shape as cefr below: derived when the row has none of
        # its own, so a word saved before this table existed — or saved while
        # the online dictionary was unreachable — still shows how to say it.
        ipa=pronunciation.display(row["ipa"] or pronunciation.ipa_for(row["word"])),
        audio_url=row["audio_url"],
        synonyms=json.loads(row["synonyms"]),
        tags=vocabulary.get_tags(conn, row["id"]),
        context_count=vocabulary.context_count(conn, row["id"]),
        ai_mnemonic=row["ai_mnemonic"],
        ai_definition=_opt(row, "ai_definition"),
        ai_examples=json.loads(_opt(row, "ai_examples") or "[]"),
        ai_usage_note=_opt(row, "ai_usage_note"),
        ai_sense_definition=_opt(row, "ai_sense_definition"),
        created_at=row["created_at"],
        **_scheduling(conn, row),
    )


def _opt(row: sqlite3.Row, key: str):
    """A column that may not be in this particular SELECT."""
    return row[key] if key in row.keys() else None


def _scheduling(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    """Scheduling state for a word row, when the query joined it in.

    `get_word_row` and friends return a bare vocab_words row, so every field
    here is optional — a detail view is not worth a second query just to
    decorate it with numbers the list already shows."""
    keys = row.keys()
    if "card_state" not in keys:
        return {}
    card = fsrs.Card(
        stability=row["stability"] or 0.0,
        difficulty=row["difficulty"] or 0.0,
        reps=row["reps"] or 0,
        lapses=row["lapses"] or 0,
        state=row["card_state"] or "new",
    )
    mastery = review.mastery_for(card, review.spontaneous_sessions(conn, row["id"]))
    return {
        "card_state": row["card_state"],
        "due": row["due"],
        "stability_days": round(card.stability, 1),
        "difficulty": round(card.difficulty, 1),
        "reps": card.reps,
        "lapses": card.lapses,
        "suspended": bool(row["suspended"]),
        "mastery_level": mastery.level,
        "mastery_label": mastery.label,
    }


def _row_to_context_out(row: sqlite3.Row) -> VocabContextOut:
    keys = row.keys()
    return VocabContextOut(
        id=row["id"],
        kind=row["kind"],
        snippet=row["snippet"],
        source_label=row["source_label"],
        book_id=row["book_id"],
        block_index=row["block_index"],
        page=row["page"] if "page" in keys else None,
        created_at=row["created_at"],
        media_item_id=row["media_item_id"] if "media_item_id" in keys else None,
        start_ms=row["start_ms"] if "start_ms" in keys else None,
        end_ms=row["end_ms"] if "end_ms" in keys else None,
        clip_id=row["clip_id"] if "clip_id" in keys else None,
        clip_status=row["clip_status"] if "clip_status" in keys else None,
    )


def _row_to_note_out(row: sqlite3.Row) -> VocabNoteOut:
    return VocabNoteOut(id=row["id"], text=row["text"], created_at=row["created_at"])


def _get_owned_word_row(conn: sqlite3.Connection, vocab_word_id: str, user_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM vocab_words WHERE id = ? AND user_id = ?", (vocab_word_id, user_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vocabulary word not found")
    return row


@router.get("", response_model=list[VocabWordOut])
def list_words(
    user_id: str,
    q: str = "",
    cefr: str | None = None,
    tag: str | None = None,
    status_filter: str = "all",
    sort: str = "recent",
    conn: sqlite3.Connection = Depends(get_db),
) -> list[VocabWordOut]:
    """Filtered and ordered in SQL rather than in the browser.

    The search used to run client-side over whatever had already been
    fetched, which quietly stops working as a collection grows — and the only
    ordering was when a word happened to be saved."""
    if status_filter not in vocabulary.STATUS_FILTERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unknown status filter")
    if sort not in vocabulary.SORT_ORDERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unknown sort order")
    rows = vocabulary.list_words(
        conn, user_id, query=q, cefr=cefr, tag=tag, status=status_filter, sort=sort
    )
    return [_row_to_word_out(conn, row) for row in rows]


@router.get("/overview", response_model=VocabOverviewOut)
def get_overview(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> VocabOverviewOut:
    """Counts for the summary header and the filter chips, so the list opens
    on something other than an undifferentiated wall of words."""
    return VocabOverviewOut(**vocabulary.overview(conn, user_id))


@router.get("/by-word/{word}", response_model=VocabWordDetailOut)
def get_word_detail(word: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> VocabWordDetailOut:
    row = vocabulary.get_word_row(conn, user_id, word)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Word not saved")
    base = _row_to_word_out(conn, row)
    return VocabWordDetailOut(
        **base.model_dump(),
        contexts=[_row_to_context_out(r) for r in vocabulary.get_contexts(conn, row["id"])],
        notes=[_row_to_note_out(r) for r in vocabulary.get_notes(conn, row["id"])],
        conversation_usage=conversation.word_usage_counts(conn, row["id"]),
        flashcard_reviews=conversation.flashcard_review_counts(conn, row["id"]),
    )


@router.post("", response_model=VocabWordSaveOut)
def save_word(payload: VocabWordCreate, conn: sqlite3.Connection = Depends(get_db)) -> VocabWordSaveOut:
    result = vocabulary.save_word(
        conn,
        user_id=payload.user_id,
        word=payload.word,
        sentence=payload.sentence,
        book_id=payload.book_id,
        block_index=payload.block_index,
        page=payload.page,
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f'"{payload.word}" isn\'t in the offline dictionary',
        )
    row, already_existed = result
    return VocabWordSaveOut(word=_row_to_word_out(conn, row), already_saved=already_existed)


@router.get("/dictionary-search", response_model=DictionarySearchOut)
def dictionary_search(w: str, conn: sqlite3.Connection = Depends(get_db)) -> DictionarySearchOut:
    word = (w or "").strip()
    if not word:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="w is required")

    # Nearest source first: the bundled lexicon, then everything this machine
    # has already looked up, and only then the network. This used to go
    # straight out to the internet every time, so the same word cost the same
    # two or three seconds however often it was searched.
    try:
        result = dictionary.look_up(conn, word).result
    except dictionary.DictionaryServiceUnavailable as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Couldn't reach the online dictionary — check your internet connection",
        ) from err

    # Real CEFR/simpler-word data when our own offline lexicon also happens
    # to know the word; dictionaryapi.dev has neither, so these are never
    # invented to fill the gap.
    local = cefr_lexicon.lookup(word)
    # The band comes from band_of, not from `local`, so the ~8.8k words that
    # are in the band table but not the curated lexicon still get a level —
    # which is most of them. Reading it off `local` alone is why almost every
    # saved word showed "CEFR —".
    band = cefr_lexicon.band_of(word)

    return DictionarySearchOut(
        word=result.word,
        found=result.found,
        # The online dictionary often has no phonetics even when it has the
        # word. CMUdict does, offline, for 126k words.
        ipa=pronunciation.display(result.ipa or pronunciation.ipa_for(result.word)),
        audio_url=result.audio_url,
        senses=[DictionarySenseOut(pos=s.pos, definition=s.definition, example=s.example) for s in result.senses],
        synonyms=list(result.synonyms),
        cefr=band,
        simpler=local.simpler if local is not None else None,
    )


@router.get("/dictionary-cache", response_model=DictionaryCacheOut)
def dictionary_cache_stats(conn: sqlite3.Connection = Depends(get_db)) -> DictionaryCacheOut:
    """How much of the dictionary this machine has accumulated.

    Worth showing because it explains a difference the learner can feel: the
    first lookup of a word costs a round trip, every one after it is instant.
    Worth being able to clear because it is the one store in the app that is
    entirely disposable — nothing here was authored by anyone, and deleting it
    loses nothing but the speed.
    """
    row = conn.execute(
        "SELECT COUNT(*) AS n, MAX(cached_at) AS last FROM dictionary_entries"
    ).fetchone()
    return DictionaryCacheOut(entries=row["n"], last_cached_at=row["last"])


@router.delete("/dictionary-cache", response_model=DictionaryCacheOut)
def clear_dictionary_cache(conn: sqlite3.Connection = Depends(get_db)) -> DictionaryCacheOut:
    """Empty it. It refills by itself as words are looked up again.

    Saved words are untouched: a word in someone's vocabulary carries its own
    snapshot of the definition, taken when it was saved, precisely so that it
    does not depend on this table still being here.
    """
    conn.execute("DELETE FROM dictionary_entries")
    return DictionaryCacheOut(entries=0, last_cached_at=None)


@router.post("/manual", response_model=VocabWordSaveOut)
def save_manual_word(payload: VocabWordManualCreate, conn: sqlite3.Connection = Depends(get_db)) -> VocabWordSaveOut:
    row, already_existed = vocabulary.save_manual_word(
        conn,
        user_id=payload.user_id,
        word=payload.word,
        pos=payload.pos,
        definition=payload.definition,
        example=payload.example,
        synonyms=payload.synonyms,
        ipa=payload.ipa,
        audio_url=payload.audio_url,
        note_text=payload.note,
        ai_definition=payload.ai_definition,
        ai_examples=payload.ai_examples,
        ai_mnemonic=payload.ai_mnemonic,
        ai_usage_note=payload.ai_usage_note,
        ai_sense_definition=payload.ai_sense_definition,
    )
    return VocabWordSaveOut(word=_row_to_word_out(conn, row), already_saved=already_existed)


@router.delete("/{vocab_word_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_word(vocab_word_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    if not vocabulary.delete_word(conn, user_id, vocab_word_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vocabulary word not found")


@router.post("/{vocab_word_id}/notes", response_model=VocabNoteOut, status_code=status.HTTP_201_CREATED)
def add_note(
    vocab_word_id: str, user_id: str, payload: VocabNoteCreate, conn: sqlite3.Connection = Depends(get_db)
) -> VocabNoteOut:
    _get_owned_word_row(conn, vocab_word_id, user_id)
    return _row_to_note_out(vocabulary.add_note(conn, vocab_word_id, payload.text))


@router.delete("/{vocab_word_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    vocab_word_id: str, note_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)
) -> None:
    _get_owned_word_row(conn, vocab_word_id, user_id)
    if not vocabulary.delete_note(conn, vocab_word_id, note_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")


@router.post("/{vocab_word_id}/tags", response_model=list[str])
def add_tag(
    vocab_word_id: str, user_id: str, payload: VocabTagCreate, conn: sqlite3.Connection = Depends(get_db)
) -> list[str]:
    _get_owned_word_row(conn, vocab_word_id, user_id)
    return vocabulary.add_tag(conn, vocab_word_id, payload.tag)


@router.delete("/{vocab_word_id}/tags/{tag}", response_model=list[str])
def remove_tag(vocab_word_id: str, tag: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[str]:
    _get_owned_word_row(conn, vocab_word_id, user_id)
    return vocabulary.remove_tag(conn, vocab_word_id, tag)


@router.get("/{vocab_word_id}/pronounce")
async def pronounce(
    vocab_word_id: str,
    user_id: str,
    part: str = "word",
    conn: sqlite3.Connection = Depends(get_db),
) -> FileResponse:
    """Speaks the word, or its example sentence, with the local TTS engine.

    Spec §5.3 asks for "TTS pronunciation of both the word and the sentence".
    Until now the page could only offer audio that happened to ship with a
    dictionary entry, so a manually added word — or any word the dictionary
    had no recording for — simply had no pronunciation at all. The engine
    that speaks in Conversation can say any of them.

    Cached on disk after the first request, keyed by engine and part: this is
    real synthesis, and a word's pronunciation does not change."""
    row = conn.execute(
        "SELECT id, word, example FROM vocab_words WHERE id = ? AND user_id = ?",
        (vocab_word_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Word not saved")

    text = row["word"] if part == "word" else (row["example"] or "")
    if not text.strip():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No example sentence to speak"
        )

    engine = tts.selected_name(conn, user_id)
    try:
        path = await run_in_threadpool(vocabulary.pronunciation_path, row["id"], text, part, engine)
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    return FileResponse(str(path), media_type="audio/wav")


@router.post("/ai-explain", response_model=AiExplainOut)
def ai_explain(payload: AiExplainIn, conn: sqlite3.Connection = Depends(get_db)) -> AiExplainOut:
    """The AI alternative to dictionary-search: define a word as used in a
    learner-pasted sentence, for words the offline lexicon/online dictionary
    don't have (slang, names, domain jargon) or where context disambiguates
    a sense a plain dictionary lookup can't."""
    if not payload.word.strip() or not payload.context.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="word and context are required")
    try:
        result = vocabulary_ai.explain_in_context(
            conn, user_id=payload.user_id, word=payload.word, context=payload.context
        )
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    return AiExplainOut(**result)


@router.post("/ai-enrich", response_model=AiEnrichOut)
def ai_enrich(payload: AiEnrichIn, conn: sqlite3.Connection = Depends(get_db)) -> AiEnrichOut:
    """The AI half of adding a word, run alongside the dictionary rather than
    as an alternative to it.

    A dictionary defines a word for someone who already speaks the language.
    What a learner needs on top — a definition at their level, sentences they
    might really say, a hook to remember it by, a note on register — is
    exactly what dictionaries omit."""
    word = payload.word.strip()
    if not word:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="word is required")
    try:
        result = vocabulary_ai.enrich_word(
            conn,
            user_id=payload.user_id,
            word=word,
            dictionary_definition=payload.dictionary_definition,
            context=payload.context,
        )
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    return AiEnrichOut(**result)


@router.get("/speak")
async def speak(text: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> FileResponse:
    """Says a short piece of text with the local voice.

    Exists so a word can be heard BEFORE it is saved — the per-word endpoint
    needs an id, and deciding whether to keep a word is exactly when hearing
    it is most useful. Capped and cached by content hash, because this is one
    request away from being an open text-to-speech service for anything."""
    clean = (text or "").strip()
    if not clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text is required")
    if len(clean) > 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text is too long to speak")
    engine = tts.selected_name(conn, user_id)
    try:
        path = await run_in_threadpool(vocabulary.speech_path, clean, engine)
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    return FileResponse(str(path), media_type="audio/wav")


@router.post("/{vocab_word_id}/ai-examples", response_model=AiExamplesOut)
def ai_examples(
    vocab_word_id: str, user_id: str, count: int = 3, conn: sqlite3.Connection = Depends(get_db)
) -> AiExamplesOut:
    row = _get_owned_word_row(conn, vocab_word_id, user_id)
    try:
        examples = vocabulary_ai.generate_examples(
            conn, user_id=user_id, word_row=row, count=max(1, min(count, 5))
        )
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    return AiExamplesOut(examples=examples)


@router.post("/{vocab_word_id}/ai-mnemonic", response_model=AiMnemonicOut)
def ai_mnemonic(vocab_word_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> AiMnemonicOut:
    row = _get_owned_word_row(conn, vocab_word_id, user_id)
    try:
        mnemonic = vocabulary_ai.generate_mnemonic(conn, user_id=user_id, word_row=row)
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    return AiMnemonicOut(mnemonic=mnemonic)


@router.post("/{vocab_word_id}/ai-practice", response_model=AiPracticeOut)
def ai_practice(vocab_word_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> AiPracticeOut:
    row = _get_owned_word_row(conn, vocab_word_id, user_id)
    try:
        question = vocabulary_ai.generate_practice_question(conn, user_id=user_id, word_row=row)
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    return AiPracticeOut(question=question)
