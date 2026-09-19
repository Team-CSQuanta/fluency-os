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
    trees: list[TreeOut]
    biomes: list[BiomeOut]
    # One count per growth stage, in stage order.
    stages: list[int]
    stage_names: list[str]
    sunlight: int
    sunlight_earned: int
    streak_freezes: int
    dormant: int
    costs: dict[str, int]


class SpendIn(BaseModel):
    user_id: str
    kind: str
    vocab_word_id: str | None = None


class SpendOut(BaseModel):
    kind: str
    cost: int
    balance: int


class FocusStartIn(BaseModel):
    user_id: str
    minutes: int = 25


class FocusOut(BaseModel):
    id: str
    minutes: int
    started_at: str
    completed_at: str | None = None
    sunlight: int = 0
