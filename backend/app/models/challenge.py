"""Request/response shapes for the Scene Description Challenge (spec §6.4)."""

from typing import Literal

from pydantic import BaseModel

# Historical rounds still carry the older values, so the response model must
# keep accepting them — only "describe" on a "vatex" scene can be started now.
ChallengeKind = Literal["describe", "predict", "roleplay", "interrogate", "reword"]
ChallengeSource = Literal["library", "vatex"]


class SceneWordOut(BaseModel):
    word: str
    cefr: str
    # Whether this is already in the learner's vocabulary. A known word is a
    # reminder; an unknown one is an offer, and the interface fetches its
    # meaning on demand (see scene_vocabulary.suggest).
    known: bool


class AgreedWordOut(BaseModel):
    """A word from the reference descriptions, with how many of the ten
    describers used it. The count is shown: "six people said this" tells the
    learner how central it is, which a bare word does not."""

    word: str
    describers: int


class HintsOut(BaseModel):
    # Library rounds: the learner's own due words, plus scene vocabulary.
    target_words: list[str] = []
    scene_words: list[SceneWordOut] = []

    # VATEX rounds: graded reveals from the ten reference descriptions. Every
    # tier costs points, and `next_penalty` is what the NEXT one would cost —
    # sent so the interface can price the button before it is pressed rather
    # than after.
    level: int = 0
    max_level: int = 0
    penalty: int = 0
    next_penalty: int | None = None
    consensus_words: list[AgreedWordOut] = []
    detail_words: list[AgreedWordOut] = []
    example_caption: str | None = None
    describer_count: int = 0


class CorrectionOut(BaseModel):
    said: str
    better: str


class ChallengeFeedbackOut(BaseModel):
    note: str = ""
    corrections: list[CorrectionOut] = []
    # Kept so reports written before library rounds were removed still parse.
    target_words_used: list[str] = []
    target_words_missed: list[str] = []


class ChallengeRoundOut(BaseModel):
    id: str
    kind: ChallengeKind
    source: ChallengeSource = "library"
    prompt: str
    media_item_id: str | None
    clip_id: str | None
    media_title: str
    start_ms: int
    end_ms: int
    status: Literal["open", "scored", "abandoned"]
    target_word_count: int
    started_at: str

    # VATEX rounds only. The embed is built server-side so the host and the
    # parameters that keep playback inside the scene live in one place.
    video_id: str | None = None
    embed_url: str | None = None
    start_s: int | None = None
    end_s: int | None = None

    # Present once scored. Kept apart in the response the way they are kept
    # apart in the table: two of these are arithmetic and two are a judgement.
    transcript: str | None = None
    speech_seconds: float | None = None
    target_coverage: float | None = None
    duration_score: float | None = None
    grammar_score: int | None = None
    relevance_score: int | None = None
    detail_score: int | None = None
    # The deterministic counterpart to detail_score: the share of the
    # describers' collective observations the learner reached, weighted by how
    # many of them made each one. Recorded alongside the judged figure so the
    # two can be compared on real rounds.
    content_recall: float | None = None
    # What the description scored before hints were deducted, and what they
    # cost. Kept apart so the learner sees both rather than one number that
    # silently absorbed the other.
    raw_overall: int | None = None
    hint_level: int = 0
    hint_penalty: int = 0
    overall: int | None = None
    feedback: ChallengeFeedbackOut | None = None
    # The line spoken in the clip. Withheld until the attempt is scored —
    # handing it over first would be handing over the answer.
    cue_text: str | None = None
    target_words: list[str] = []
    # The ten human descriptions, revealed only after the attempt — seeing how
    # other people described the same scene is the best part of the feedback,
    # and handing them over first would be handing over the answer.
    reference_captions: list[str] = []


class EnrichedWordOut(BaseModel):
    """One of the learner's own words that the enrichment actually used.

    Verified against the text before it gets here — a model asked which words
    it used will name ones it did not.
    """

    word: str
    vocab_word_id: str
    why: str = ""


class EnrichmentOut(BaseModel):
    description: str
    used_words: list[EnrichedWordOut] = []
    # True when this came back from the round rather than from a fresh model
    # call, so the interface can say so instead of implying it was just written.
    cached: bool = False


class ChallengeStartIn(BaseModel):
    """There is one kind of round now, so this carries only who is playing."""

    user_id: str


class ScenePoolOut(BaseModel):
    """How much of the corpus a learner can actually be served right now.

    `available` is the honest number: the total minus videos withdrawn as
    unplayable, minus the ones resting inside this learner's own cooldown.
    """

    total: int = 0
    unavailable: int = 0
    resting: int = 0
    available: int = 0
    cooldown_days: int = 60


class ChallengeStatsOut(BaseModel):
    # Kinds never played are absent, not zero — see challenge.personal_bests.
    personal_bests: dict[str, int]
    rounds_played: int
    stt_ready: bool
    scenes_available: int = 0
    # Playing a VATEX scene contacts youtube-nocookie.com. Off until asked for.
    embeds_enabled: bool = False
    scene_pool: ScenePoolOut = ScenePoolOut()


class EmbedPrefIn(BaseModel):
    user_id: str
    enabled: bool
