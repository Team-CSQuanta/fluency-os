"""AI-powered additions to the Vocabulary feature, backed by whichever LLM
Conversation is currently configured to use — local (llama.cpp), OpenRouter,
or Gemini — same provider dispatch as app/services/conversation.py. Gated
the same way Conversation gates real AI use: the model must be both
downloaded/configured (_ensure_ready) and, for the local provider, actually
loaded into memory via the explicit "Launch AI" action (_ensure_launched),
or these raise EngineUnavailable with the same actionable message
Conversation uses.
"""

import sqlite3

from app.services import conversation, conversation_report
from app.services.voice import cloud_llm_engine, gemini_llm_engine, llm_chat_engine

_JSON_ONLY = "Respond with ONLY a JSON object (no prose, no markdown fences) of the shape: "


def _llm_target(conn: sqlite3.Connection, user_id: str) -> dict:
    conversation._ensure_ready(conn, user_id, "text")
    target = conversation.llm_target(conn, user_id)
    conversation._ensure_launched({"llm"}, llm_target=target)
    return target


def _generate_json(
    target: dict, system_prompt: str, user_prompt: str, *, max_tokens: int = 300, temperature: float = 0.4
) -> dict:
    if target["provider"] != "local":
        engine = gemini_llm_engine if target["provider"] == "gemini" else cloud_llm_engine
        return engine.generate_json(
            system_prompt,
            user_prompt,
            api_key=target["api_key"],
            model=target["model"],
            max_tokens=max_tokens,
            temperature=temperature,
        )
    option = target["option"]
    return llm_chat_engine.generate_json(
        system_prompt,
        user_prompt,
        repo_id=option.repo_id,
        filename=option.filename,
        max_tokens=max_tokens,
        temperature=temperature,
    )


def explain_in_context(conn: sqlite3.Connection, *, user_id: str, word: str, context: str) -> dict:
    """The AI half of "add a word": given a sentence/paragraph the learner
    pasted and the specific word in it they don't know, define it as used
    THERE, rather than every dictionary sense of the word out of context."""
    target = _llm_target(conn, user_id)
    system_prompt = (
        "You are a concise, accurate English dictionary and language tutor. Given a WORD and "
        "the CONTEXT sentence it appeared in, explain what the word means specifically AS USED "
        "in that context — not every possible dictionary sense. "
        + _JSON_ONLY
        + '{"pos": string (e.g. "noun", "verb", "adjective"), "definition": string (<=25 words, '
        'plain language), "example": string (one new sentence using the word correctly), '
        '"synonyms": [string, ...] (up to 4, may be empty)}.'
    )
    user_prompt = f"Word: {word}\nContext: {context}"
    data = _generate_json(target, system_prompt, user_prompt, max_tokens=250)
    return {
        "word": word.strip(),
        "pos": str(data.get("pos") or "").strip() or "unknown",
        "definition": str(data.get("definition") or "").strip(),
        "example": str(data.get("example") or "").strip(),
        "synonyms": [str(s).strip() for s in (data.get("synonyms") or []) if str(s).strip()],
    }


def enrich_word(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    word: str,
    dictionary_definition: str | None = None,
    context: str | None = None,
) -> dict:
    """The AI half of adding a word, alongside the dictionary rather than
    instead of it.

    A dictionary defines a word for someone who already speaks the language;
    the parts a learner actually needs — a definition pitched at their level,
    sentences they might really say, a hook to remember it by, and a warning
    about register — are exactly what dictionaries leave out. Given the
    dictionary's own definition as grounding, a small local model does this
    well, and grounding it is what keeps it from inventing a sense.

    `context` is optional: a word can be added from nothing but itself.
    """
    grounding = ""
    if dictionary_definition:
        grounding += f'\nA dictionary defines it as: "{dictionary_definition}"'
    if context:
        grounding += f'\nThe learner met it here: "{context}"'

    system_prompt = (
        "You help someone learning English record a new word. Respond with ONLY a JSON object "
        "(no prose, no markdown fences) with exactly these keys: "
        '"definition": a plain one-sentence meaning a B1 learner would understand, '
        '"examples": an array of exactly 2 natural sentences a person might really say, using the word, '
        '"mnemonic": one short vivid memory hook, '
        '"usage_note": at most 8 words on when to use it (e.g. "formal writing; rare in speech"), '
        '"synonyms": an array of up to 4 near-synonyms. '
        "Never invent a meaning the word does not have."
    )
    user_prompt = f"Word: {word}{grounding}"

    target = _llm_target(conn, user_id)
    raw = _generate_json(target, system_prompt, user_prompt, max_tokens=400)

    def _text(key: str) -> str:
        value = raw.get(key)
        return value.strip() if isinstance(value, str) else ""

    def _list(key: str, limit: int) -> list[str]:
        value = raw.get(key)
        if not isinstance(value, list):
            return []
        return [str(v).strip() for v in value if str(v).strip()][:limit]

    # An example sentence that does not contain the word teaches nothing about
    # the word, and a 1B model produces them regularly — observed asking for
    # "excerpt" and getting "I need to read the entire article before I can
    # understand it." Checked rather than trusted, on the same lemma rules the
    # transcript search uses, so an inflected form still counts.
    examples = [
        e for e in _list("examples", 4) if conversation_report.says_word(e, word)
    ][:2]

    return {
        "definition": _text("definition"),
        "examples": examples,
        "mnemonic": _text("mnemonic"),
        "usage_note": _text("usage_note"),
        "synonyms": [s for s in _list("synonyms", 6) if s.lower() != word.lower()][:4],
    }


def generate_examples(conn: sqlite3.Connection, *, user_id: str, word_row: sqlite3.Row, count: int = 3) -> list[str]:
    """Fresh example sentences for an already-saved word — regenerated live
    each time rather than cached, since variety is the point (unlike the
    mnemonic below, which deliberately stays fixed)."""
    target = _llm_target(conn, user_id)
    definition = word_row["definition"] or "(no definition saved)"
    system_prompt = (
        f"You are a language-learning tutor. Write {count} short, natural example sentences that "
        "correctly use the given word, each in a clearly different context. "
        + _JSON_ONLY
        + '{"examples": [string, ...]}.'
    )
    user_prompt = f"Word: {word_row['word']}\nDefinition: {definition}"
    data = _generate_json(target, system_prompt, user_prompt, max_tokens=300)
    examples = [str(s).strip() for s in (data.get("examples") or []) if str(s).strip()]
    # Same check as enrich_word: a sentence that doesn't contain the word is
    # not an example of it, and a small model produces those regularly.
    examples = [e for e in examples if conversation_report.says_word(e, word_row["word"])]
    return examples[:count]


def generate_mnemonic(conn: sqlite3.Connection, *, user_id: str, word_row: sqlite3.Row) -> str:
    """Generates AND persists — a mnemonic is a memory hook, so regenerating
    a different one on every page view would undermine the point. Overwrites
    only when the learner explicitly asks to regenerate."""
    target = _llm_target(conn, user_id)
    definition = word_row["definition"] or "(no definition saved)"
    system_prompt = (
        "You are a language-learning tutor. Create ONE short, vivid memory aid (mnemonic — a vivid "
        "image, sound-alike association, or root-word breakdown) to help remember the meaning of the "
        "given word. Keep it under 30 words. "
        + _JSON_ONLY
        + '{"mnemonic": string}.'
    )
    user_prompt = f"Word: {word_row['word']}\nDefinition: {definition}"
    data = _generate_json(target, system_prompt, user_prompt, max_tokens=120)
    mnemonic = str(data.get("mnemonic") or "").strip()
    conn.execute("UPDATE vocab_words SET ai_mnemonic = ? WHERE id = ?", (mnemonic, word_row["id"]))
    conn.commit()
    return mnemonic


def generate_practice_question(conn: sqlite3.Connection, *, user_id: str, word_row: sqlite3.Row) -> str:
    """A quick fill-in-the-blank practice prompt, generated live each time
    (like a quiz) rather than persisted — every attempt should be a fresh
    check, not a memorized static sentence."""
    target = _llm_target(conn, user_id)
    definition = word_row["definition"] or "(no definition saved)"
    system_prompt = (
        "You are a language-learning tutor. Write ONE fill-in-the-blank practice sentence for the "
        "given word: replace the word itself with '_____' in the sentence, and make the surrounding "
        "context clear enough that the correct word is inferable. Do not reveal the word anywhere else "
        "in the sentence. "
        + _JSON_ONLY
        + '{"question": string}.'
    )
    user_prompt = f"Word: {word_row['word']}\nDefinition: {definition}"
    data = _generate_json(target, system_prompt, user_prompt, max_tokens=120)
    return str(data.get("question") or "").strip()
