"""The leveling contract: one signature, two implementations (spec §7.3).

    level(text, mode, target_cefr) -> LeveledText

The router never knows which engine ran, and `engine` is part of the cache key
so an LLM result can never collide with a rules result for the same paragraph.

The result is a *segment list* rather than the fixed before/sub1/mid/sub2/after
shape the mock panel used. A real paragraph can need any number of
substitutions; five fixed slots silently drop the sixth. Segments render
identically — plain runs, with substituted runs underlined and carrying their
original as a tooltip — and the substitution ledger falls out of them for free.
"""

from dataclasses import dataclass, field
from typing import Literal, Protocol

Mode = Literal["inline", "lexical", "contextual", "semantic"]
MODES: tuple[Mode, ...] = ("inline", "lexical", "contextual", "semantic")

# Which modes can run with no model installed. The other two need generation
# and are gated on a configured model — see llm_engine.
RULES_MODES: tuple[Mode, ...] = ("inline", "lexical")
GENERATIVE_MODES: tuple[Mode, ...] = ("contextual", "semantic")


class EngineUnavailable(RuntimeError):
    """Raised when a mode needs generation and no model is configured.

    Not an error condition — it is the app's normal offline state, and the
    Level panel has honest copy for it. The router turns it into a 200 with
    `available: false`, never a 5xx.
    """


@dataclass(frozen=True)
class LeveledSegment:
    text: str
    # None for untouched prose; the original wording when this run replaced
    # something, which is what the underline and the ledger key off.
    original: str | None = None


@dataclass(frozen=True)
class LeveledText:
    mode: str
    target_cefr: str
    engine: str
    original: str
    segments: tuple[LeveledSegment, ...] = ()
    available: bool = True
    # Set when a mode degraded or could not run, so the panel can say why
    # instead of quietly showing something other than what was asked for.
    note: str | None = None

    @property
    def text(self) -> str:
        return "".join(s.text for s in self.segments)

    @property
    def substitutions(self) -> list[tuple[str, str]]:
        return [(s.original, s.text) for s in self.segments if s.original is not None]


@dataclass
class LevelRequest:
    text: str
    mode: Mode
    target_cefr: str
    extras: dict = field(default_factory=dict)


class Engine(Protocol):
    name: str

    def supports(self, mode: Mode) -> bool: ...

    def level(self, text: str, mode: Mode, target_cefr: str) -> LeveledText: ...
