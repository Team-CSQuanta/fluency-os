import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.db import get_db
from app.models.vocabulary import (
    AiExamplesOut,
    AiExplainIn,
    AiExplainOut,
    AiMnemonicOut,
    AiPracticeOut,
    DictionarySearchOut,
    DictionarySenseOut,
    VocabContextOut,
    VocabNoteCreate,
    VocabNoteOut,
    VocabTagCreate,
    VocabWordCreate,
    VocabWordDetailOut,
    VocabWordManualCreate,
    VocabWordOut,
    VocabWordSaveOut,
)
from app.security import require_token
from app.services import cefr_lexicon, conversation, dictionary_lookup, vocabulary, vocabulary_ai
from app.services.voice.errors import EngineUnavailable

router = APIRouter(prefix="/vocabulary", dependencies=[Depends(require_token)])


def _row_to_word_out(conn: sqlite3.Connection, row: sqlite3.Row) -> VocabWordOut:
    return VocabWordOut(
        id=row["id"],
        user_id=row["user_id"],
        word=row["word"],
        lemma=row["lemma"],
        pos=row["pos"],
        cefr=row["cefr"],
        definition=row["definition"],
        example=row["example"],
        simpler=row["simpler"],
        ipa=row["ipa"],
        audio_url=row["audio_url"],
        synonyms=json.loads(row["synonyms"]),
        tags=vocabulary.get_tags(conn, row["id"]),
        context_count=vocabulary.context_count(conn, row["id"]),
        ai_mnemonic=row["ai_mnemonic"],
        created_at=row["created_at"],
    )


def _row_to_context_out(row: sqlite3.Row) -> VocabContextOut:
    return VocabContextOut(
        id=row["id"],
        kind=row["kind"],
        snippet=row["snippet"],
        source_label=row["source_label"],
        book_id=row["book_id"],
        block_index=row["block_index"],
        created_at=row["created_at"],
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
def list_words(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[VocabWordOut]:
    return [_row_to_word_out(conn, row) for row in vocabulary.list_words(conn, user_id)]


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
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f'"{payload.word}" isn\'t in the offline dictionary',
        )
    row, already_existed = result
    return VocabWordSaveOut(word=_row_to_word_out(conn, row), already_saved=already_existed)


@router.get("/dictionary-search", response_model=DictionarySearchOut)
def dictionary_search(w: str) -> DictionarySearchOut:
    word = (w or "").strip()
    if not word:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="w is required")

    try:
        result = dictionary_lookup.search(word)
    except dictionary_lookup.DictionaryServiceUnavailable as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Couldn't reach the online dictionary — check your internet connection",
        ) from err

    # Real CEFR/simpler-word data when our own offline lexicon also happens
    # to know the word; dictionaryapi.dev has neither, so these are never
    # invented to fill the gap.
    local = cefr_lexicon.lookup(word)

    return DictionarySearchOut(
        word=result.word,
        found=result.found,
        ipa=result.ipa,
        audio_url=result.audio_url,
        senses=[DictionarySenseOut(pos=s.pos, definition=s.definition, example=s.example) for s in result.senses],
        synonyms=list(result.synonyms),
        cefr=local.cefr if local is not None else None,
        simpler=local.simpler if local is not None else None,
    )


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
