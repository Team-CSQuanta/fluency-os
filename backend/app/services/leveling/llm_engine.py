"""The generative half of leveling: `contextual` and `semantic` (spec §7.3).

Both modes reorder and rewrite whole sentences, which no wordlist can do, so
both need a model. This is the engine that asks one.

It goes through the same dispatch as every other AI feature in the app
(vocabulary's explanations, the challenge judge): the provider the reader
configured, behind the same two gates — the model has to be downloaded or a
key configured, AND, for a local model, actually launched into memory. A
reader who has not started their AI gets the same "it isn't running" answer
here as everywhere else, rather than a quietly different result.

What comes back is a rewrite plus the list of phrases the model replaced, so
the panel can underline what changed and show what it was before. A rewrite
with no account of what it changed would be untraceable against the source,
which is the one thing a reader of a difficult text cannot afford.
"""

import sqlite3

from app.services import vocabulary_ai
from app.services.leveling.base import (
    GENERATIVE_MODES,
    EngineUnavailable,
    LeveledSegment,
    LeveledText,
    Mode,
)
from app.services.voice.errors import EngineUnavailable as VoiceEngineUnavailable

# How many phrases the ledger will carry. A cap because the list is read by a
# person, and because a model asked for "every change" will pad it.
_MAX_CHANGES = 8

_SHAPE = (
    'Respond with ONLY a JSON object (no prose, no markdown fences) of the shape: '
    '{"rewrite": string, "changes": [{"from": string, "to": string}, ...]}. '
    '"changes" lists the hard wordings you replaced (at most 8), each "from" quoted '
    'exactly as it appears in the passage and each "to" exactly as it appears in your '
    'rewrite. It may be empty.'
)

_RULES = (
    "Keep every fact, name, number, symbol and equation exactly as it is. Do not add "
    "anything the passage does not say, do not comment on it, and do not leave anything "
    "out. Keep the author's meaning even where you change the words."
)


def _prompt(mode: Mode, target_cefr: str) -> str:
    if mode == "semantic":
        return (
            "You explain difficult passages to a language learner reading at CEFR level "
            f"{target_cefr}. Say what the passage MEANS, in one or two plain sentences. "
            + _RULES
            + " "
            + _SHAPE
        )
    return (
        "You rewrite passages so a language learner reading at CEFR level "
        f"{target_cefr} can follow them. Keep the same structure and length where you "
        "can, and replace only what is too hard. " + _RULES + " " + _SHAPE
    )


def configured_model(conn: sqlite3.Connection, user_id: str | None) -> str | None:
    """The model id this user has configured, or None when running offline."""
    if user_id is None:
        return None
    row = conn.execute(
        "SELECT llm_mode, llm_model_id FROM user_settings WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None:
        return None
    model_id = row["llm_model_id"]
    if not model_id:
        return None
    return str(model_id)


def weave(rewrite: str, changes: list[tuple[str, str]]) -> tuple[LeveledSegment, ...]:
    """The rewrite, with the phrases the model replaced marked as replacements.

    Each replacement is matched to the first place in the rewrite that is not
    already spoken for, so a model that says it replaced the same word twice
    marks two different words rather than the same one twice. Anything the
    model claims to have written but did not is dropped: the underline has to
    point at text that is actually there.
    """
    spans: list[tuple[int, int, str]] = []
    for original, replacement in changes:
        if not original or not replacement:
            continue
        at = rewrite.find(replacement)
        while at != -1 and any(at < end and at + len(replacement) > start for start, end, _ in spans):
            at = rewrite.find(replacement, at + 1)
        if at == -1:
            continue
        spans.append((at, at + len(replacement), original))

    spans.sort()
    segments: list[LeveledSegment] = []
    cursor = 0
    for start, end, original in spans:
        if start > cursor:
            segments.append(LeveledSegment(rewrite[cursor:start]))
        segments.append(LeveledSegment(rewrite[start:end], original=original))
        cursor = end
    if cursor < len(rewrite):
        segments.append(LeveledSegment(rewrite[cursor:]))
    return tuple(segments) if segments else (LeveledSegment(rewrite),)


def _changes(raw: object) -> list[tuple[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[tuple[str, str]] = []
    for item in raw[:_MAX_CHANGES]:
        if not isinstance(item, dict):
            continue
        original = str(item.get("from") or "").strip()
        replacement = str(item.get("to") or "").strip()
        if original and replacement and original != replacement:
            out.append((original, replacement))
    return out


def _in_readers_words(reason: str) -> str:
    """The gates are shared with Conversation, and were written there.

    The sentence is the right one either way — what is missing, and what to do
    about it — but its tail names the wrong feature, and being told to install
    something "before starting a conversation" while reading a book is the kind
    of seam that makes an application feel like a set of separate programs.
    """
    return reason.replace("before starting a conversation", "before asking for simpler words")


class LlmEngine:
    def __init__(
        self,
        model_id: str | None = None,
        *,
        conn: sqlite3.Connection | None = None,
        user_id: str | None = None,
    ) -> None:
        self.model_id = model_id
        self.conn = conn
        self.user_id = user_id
        self.name = f"llm:{model_id}" if model_id else "llm:unconfigured"

    def supports(self, mode: Mode) -> bool:
        return mode in GENERATIVE_MODES

    def level(self, text: str, mode: Mode, target_cefr: str) -> LeveledText:
        if not self.supports(mode):
            raise EngineUnavailable(f"{mode} is handled by the rules engine")
        if self.model_id is None:
            raise EngineUnavailable(
                "No language model is configured, so this rewrite can't be generated."
            )
        if self.conn is None or self.user_id is None:
            raise EngineUnavailable(
                "This rewrite needs to know whose AI to run, and was asked for without a reader."
            )

        try:
            target = vocabulary_ai._llm_target(self.conn, self.user_id)
            data = vocabulary_ai._generate_json(
                target,
                _prompt(mode, target_cefr),
                text,
                max_tokens=700,
                temperature=0.3,
            )
        except VoiceEngineUnavailable as exc:
            # The two gates — not downloaded / not launched — reach the reader
            # in the one vocabulary the whole app uses for this.
            raise EngineUnavailable(_in_readers_words(str(exc))) from exc

        rewrite = str(data.get("rewrite") or "").strip()
        if not rewrite or rewrite == text.strip():
            # Not a failure, and not something to dress up as a result: the
            # caller shows the note and leaves the passage alone.
            return LeveledText(
                mode=mode,
                target_cefr=target_cefr,
                engine=self.name,
                original=text,
                segments=(LeveledSegment(text),),
                note="The AI read this passage and left it as it was.",
            )

        return LeveledText(
            mode=mode,
            target_cefr=target_cefr,
            engine=self.name,
            original=text,
            segments=weave(rewrite, _changes(data.get("changes"))),
        )
