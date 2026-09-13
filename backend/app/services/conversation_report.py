"""Post-chat analysis: what the report measures, and who measures it.

Every field is either DETERMINISTIC (computed here from the transcript, so it
is reproducible, free, and unit-testable) or JUDGED (asked of the LLM, because
it genuinely needs language understanding). Keeping that line sharp is what
makes the report defensible: a model asked for a "fluency score" will invent
one, whereas a model asked whether a learner used a word correctly is doing
work only a language model can do.

This module is also the single source of truth for the judged half. The prompt
is rendered FROM `LlmReportAnalysis`, and `end_session` parses INTO it, so the
keys requested and the keys read cannot drift apart. They did drift once: the
prompt asked for three keys while the reader expected six, leaving four report
fields permanently zero on every real session while the tests passed. See
docs/conversation-report-design.md.
"""

import re
from dataclasses import dataclass

from pydantic import BaseModel, Field

from app.services import cefr_lexicon

# Lexical hesitation markers. Deliberately a short, explicit list of items that
# are unambiguously fillers in English rather than a cleverer heuristic — the
# number is reported as a rate, and a wrong word in this list quietly skews it.
FILLER_WORDS = frozenset({"um", "uh", "erm", "ah", "hmm", "mmm", "like", "basically", "actually"})

# Used only when a learner has no CEFR level recorded yet (placement not done).
DEFAULT_CEFR = "B1"

# Bumped whenever the report's shape changes. Reports written by an older
# version are still readable (every added field has a default) and the UI uses
# this to tell "not measured back then" apart from a genuine zero.
REPORT_VERSION = 2

_WORD_RE = re.compile(r"[a-zA-Z']+")


class ReportError(BaseModel):
    bad: str
    good: str
    why: str


class LlmReportAnalysis(BaseModel):
    """The judged half of the report — the only things the LLM is asked for.

    Field names here become the JSON keys in the prompt (see
    `report_system_prompt`), so renaming one changes both halves at once.
    """

    word_usage: dict[str, str] = Field(
        default_factory=dict,
        description='per target word: "spontaneous" | "prompted" | "incorrect" | "avoided"',
    )
    grammatical_precision: int = Field(
        default=0, description="0-100, how grammatically accurate the learner's turns were"
    )
    errors: list[ReportError] = Field(
        default_factory=list,
        description="the 3 most instructive mistakes, each as "
        '{"bad": what they said, "good": the correction, "why": a short reason}',
    )
    self_corrections: int = Field(
        default=0, description="how many times the learner caught and repaired their own mistake"
    )
    summary: str = Field(
        default="", description="2-3 encouraging sentences ending with one concrete focus for next time"
    )


def report_system_prompt(target_words: list[str]) -> str:
    """Built from LlmReportAnalysis's own fields, so the model is asked for
    exactly what the reader parses — never a hand-maintained second copy."""
    shape = ", ".join(
        f'"{name}": {field.description}' for name, field in LlmReportAnalysis.model_fields.items()
    )
    words_list = ", ".join(target_words) if target_words else "(none)"
    return (
        "You are a strict, structured language-learning analyst. Given a conversation transcript and "
        "the target vocabulary words the learner was meant to practise, respond with ONLY a JSON "
        "object (no prose, no markdown fences) with exactly these keys: {" + shape + "}. "
        '"spontaneous" = used correctly and unprompted. "prompted" = used correctly only after the AI '
        'said or hinted the word. "incorrect" = attempted but used wrongly. "avoided" = never used at all. '
        f"Judge only the learner's turns, never the AI's. Target words: {words_list}."
    )


def report_user_prompt(transcript: list[tuple[str, str]]) -> str:
    lines = "\n".join(f"{'learner' if speaker == 'user' else 'AI'}: {text}" for speaker, text in transcript)
    return f"Transcript:\n{lines}"


@dataclass(frozen=True)
class TranscriptMetrics:
    """The deterministic half. `None` means "not measurable for this session",
    which is deliberately distinct from zero — a text session has no speech
    rate at all, and reporting one would be an artifact of how fast the model
    replied rather than anything about the learner."""

    words_per_minute: int | None
    filler_rate_per_100w: float
    avg_response_delay_seconds: float | None
    longest_run_words: int
    type_token_ratio: float
    above_level_words: list[str]
    pronunciation_score: int | None
    total_words: int


def _words(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def resolve_cefr(level: str | None) -> str:
    """A learner who hasn't been placed yet still gets a usable comparison
    band rather than an above-level count that silently reads zero."""
    if level and cefr_lexicon.is_valid_band(level):
        return level.upper()
    return DEFAULT_CEFR


def compute_metrics(turns: list, target_cefr: str) -> TranscriptMetrics:
    """Pure function over turn rows. `turns` items need `speaker`, `text`,
    `created_at`, and optionally `stt_confidence` / `speech_seconds`."""
    user_turns = [t for t in turns if t["speaker"] == "user"]
    all_words = [w for t in user_turns for w in _words(t["text"])]
    total_words = len(all_words)

    fillers = sum(1 for w in all_words if w in FILLER_WORDS)
    filler_rate = round(100 * fillers / total_words, 1) if total_words else 0.0

    # Real speech time, when we have it. Text sessions never do, and using
    # wall-clock there would measure the model's latency, not the learner.
    speech_seconds = sum(_speech_seconds(t) for t in user_turns)
    words_per_minute = round(total_words / (speech_seconds / 60.0)) if speech_seconds > 0 and total_words else None

    # How long the learner took to start answering — the AI's own generation
    # time sits outside this window, unlike the old all-turn-gaps average.
    delays = []
    for prev, cur in zip(turns, turns[1:]):
        if prev["speaker"] == "ai" and cur["speaker"] == "user":
            delays.append(_seconds_between(prev["created_at"], cur["created_at"]))
    avg_response_delay = round(sum(delays) / len(delays), 1) if delays else None

    longest_run = max((len(_words(t["text"])) for t in user_turns), default=0)

    lemmas = {cefr_lexicon.normalise(w) for w in all_words}
    type_token_ratio = round(len(lemmas) / total_words, 3) if total_words else 0.0

    above_level = sorted({w for w in lemmas if cefr_lexicon.is_above_level(w, target_cefr)})

    confidences = [t["stt_confidence"] for t in user_turns if t["stt_confidence"] is not None]
    pronunciation = round(100 * sum(confidences) / len(confidences)) if confidences else None

    return TranscriptMetrics(
        words_per_minute=words_per_minute,
        filler_rate_per_100w=filler_rate,
        avg_response_delay_seconds=avg_response_delay,
        longest_run_words=longest_run,
        type_token_ratio=type_token_ratio,
        above_level_words=above_level,
        pronunciation_score=pronunciation,
        total_words=total_words,
    )


def _speech_seconds(turn) -> float:
    try:
        value = turn["speech_seconds"]
    except (KeyError, IndexError):
        return 0.0
    return float(value) if value else 0.0


def _seconds_between(start_iso: str, end_iso: str) -> float:
    from datetime import datetime

    start = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    end = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
    return (end - start).total_seconds()
