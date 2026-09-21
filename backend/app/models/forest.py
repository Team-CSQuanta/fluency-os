"""Request/response shapes for the Forest (spec §8)."""

from pydantic import BaseModel


class TreeOut(BaseModel):
    """One vocabulary word, drawn as a tree.

    Every field here is derived from the scheduler — see services/forest — so
    there is nothing the client can send back to change one.
    """

    vocab_word_id: str
    word: str
    biome: str
    # 0-5, Seed through Ancient tree.
    stage: int
    # FSRS days-until-90%-recall, which is what the stage is a band of.
    stability: float
    health: int
    dormant: bool
    lapses: int
    spontaneous_uses: int
    due: str | None = None


class BiomeOut(BaseModel):
    key: str
    label: str
    blurb: str
    count: int


class ForestOut(BaseModel):
    """The forest as a picture of a vocabulary, and nothing else.

    It used to carry a currency too — sunlight earned per review, spent on
    streak freezes and on reviving a dormant tree. The freeze was the clearest
    problem: it could be bought, it was counted, and nothing anywhere ever
    consulted it, so the streak it promised to protect broke regardless. A
    reward that does not work is worse than no reward, and the forest says
    enough on its own: these are your words, this is how well you hold them.
    """

    trees: list[TreeOut]
    # One count per growth stage, in stage order.
    stages: list[int]
    stage_names: list[str]
    dormant: int


class FocusStartIn(BaseModel):
    user_id: str
    minutes: int = 25


class FocusOut(BaseModel):
    """A block of time the learner sat through. A commitment device, not a
    faucet: it pays nothing, it only records that it happened."""

    id: str
    minutes: int
    started_at: str
    completed_at: str | None = None
