"""AI-powered additions to the Vocabulary feature, backed by whichever LLM
Conversation is currently configured to use — local (llama.cpp) or cloud
(OpenRouter), same provider dispatch as app/services/conversation.py. Gated
the same way Conversation gates real AI use: the model must be both
downloaded/configured (_ensure_ready) and, for the local provider, actually
loaded into memory via the explicit "Launch AI" action (_ensure_launched),
or these raise EngineUnavailable with the same actionable message
Conversation uses.
"""

import sqlite3

from app.services import conversation
from app.services.voice import cloud_llm_engine, llm_chat_engine

_JSON_ONLY = "Respond with ONLY a JSON object (no prose, no markdown fences) of the shape: "


def _llm_target(conn: sqlite3.Connection, user_id: str) -> dict:
    conversation._ensure_ready(conn, user_id, "text")
    target = conversation.llm_target(conn, user_id)
    conversation._ensure_launched({"llm"}, llm_target=target)
    return target


def _generate_json(
    target: dict, system_prompt: str, user_prompt: str, *, max_tokens: int = 300, temperature: float = 0.4
) -> dict:
    if target["provider"] == "cloud":
        return cloud_llm_engine.generate_json(
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
