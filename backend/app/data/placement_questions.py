"""Static question bank for the onboarding placement check.

This is a lightweight heuristic screener, not a validated psychometric CEFR
instrument (a real one is a research-grade effort out of scope for this
project) — the UI must always label it as such. 20 questions across the six
CEFR bands, ordered by increasing difficulty.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PlacementQuestion:
    id: str
    level: str  # A1 | A2 | B1 | B2 | C1 | C2
    category: str  # "grammar" | "vocabulary"
    prompt: str
    options: tuple[str, str, str, str]
    correct_index: int


QUESTIONS: tuple[PlacementQuestion, ...] = (
    # A1
    PlacementQuestion("a1-1", "A1", "grammar", "She ___ a doctor.", ("is", "are", "am", "be"), 0),
    PlacementQuestion("a1-2", "A1", "grammar", "I have two ___.", ("book", "books", "booking", "booked"), 1),
    PlacementQuestion("a1-3", "A1", "grammar", "What ___ your name?", ("is", "are", "am", "be"), 0),
    # A2
    PlacementQuestion("a2-1", "A2", "grammar", "They ___ to school every day.", ("go", "goes", "going", "went"), 0),
    PlacementQuestion(
        "a2-2", "A2", "grammar", "Yesterday, I ___ a movie.", ("watch", "watched", "watching", "watches"), 1
    ),
    PlacementQuestion(
        "a2-3", "A2", "grammar", "There ___ many people at the party.", ("was", "were", "is", "be"), 1
    ),
    # B1
    PlacementQuestion(
        "b1-1", "B1", "grammar", "If it rains tomorrow, I ___ stay home.", ("will", "would", "was", "am"), 0
    ),
    PlacementQuestion(
        "b1-2",
        "B1",
        "vocabulary",
        "Which word is closest in meaning to 'enormous'?",
        ("tiny", "huge", "quiet", "fast"),
        1,
    ),
    PlacementQuestion(
        "b1-3", "B1", "grammar", "She has been living here ___ 2015.", ("since", "for", "from", "at"), 0
    ),
    PlacementQuestion(
        "b1-4",
        "B1",
        "grammar",
        "By the time we arrived, the movie ___.",
        ("already started", "had already started", "already starts", "has already start"),
        1,
    ),
    # B2
    PlacementQuestion(
        "b2-1", "B2", "grammar", "I wish I ___ more time to finish this.", ("have", "had", "has", "having"), 1
    ),
    PlacementQuestion(
        "b2-2",
        "B2",
        "vocabulary",
        "Which word is closest in meaning to 'reluctant'?",
        ("eager", "willing", "unwilling", "happy"),
        2,
    ),
    PlacementQuestion(
        "b2-3", "B2", "grammar", "Despite ___ hard, he failed the exam.", ("study", "studying", "studied", "to study"), 1
    ),
    PlacementQuestion(
        "b2-4",
        "B2",
        "grammar",
        "The report, ___ was due yesterday, still isn't finished.",
        ("that", "which", "who", "whom"),
        1,
    ),
    # C1
    PlacementQuestion(
        "c1-1",
        "C1",
        "vocabulary",
        "Which word is closest in meaning to 'ubiquitous'?",
        ("rare", "everywhere", "hidden", "expensive"),
        1,
    ),
    PlacementQuestion(
        "c1-2",
        "C1",
        "grammar",
        "Had I known about the traffic, I ___ earlier.",
        ("would leave", "would have left", "left", "will leave"),
        1,
    ),
    PlacementQuestion(
        "c1-3",
        "C1",
        "grammar",
        "The committee's decision was met with ___ approval.",
        ("unanimous", "unanimity", "unanimously", "unanimousness"),
        0,
    ),
    # C2
    PlacementQuestion(
        "c2-1",
        "C2",
        "vocabulary",
        "Which word is closest in meaning to 'ephemeral'?",
        ("permanent", "short-lived", "ancient", "solid"),
        1,
    ),
    PlacementQuestion(
        "c2-2",
        "C2",
        "grammar",
        "Not only ___ late, but he also forgot the documents.",
        ("he was", "was he", "he is", "is he"),
        1,
    ),
    PlacementQuestion(
        "c2-3",
        "C2",
        "vocabulary",
        "The politician's speech was full of ___, saying much but meaning little.",
        ("eloquence", "verbosity", "platitudes", "rhetoric"),
        2,
    ),
)

CEFR_ORDER: tuple[str, ...] = ("A1", "A2", "B1", "B2", "C1", "C2")
