from typing import Literal

from pydantic import BaseModel

Colour = Literal["yellow", "green", "blue", "pink"]


class HighlightCreate(BaseModel):
    user_id: str
    block_index: int
    start_char: int
    end_char: int
    colour: Colour
    quoted_text: str
    note: str | None = None


class HighlightUpdate(BaseModel):
    colour: Colour | None = None
    note: str | None = None


class HighlightOut(BaseModel):
    id: str
    book_id: str
    user_id: str
    block_index: int
    start_char: int
    end_char: int
    colour: str
    quoted_text: str
    note: str | None
    created_at: str
    page: int


class BookmarkCreate(BaseModel):
    user_id: str
    block_index: int
    label: str


class BookmarkOut(BaseModel):
    id: str
    book_id: str
    user_id: str
    block_index: int
    label: str
    created_at: str
    page: int


class HighlightRect(BaseModel):
    """One painted box, in the page text layer's coordinates."""

    x: float
    y: float
    w: float
    h: float


HighlightStyle = Literal["highlight", "underline"]


class PageHighlightCreate(BaseModel):
    user_id: str
    page: int
    rects: list[HighlightRect]
    #: Open on purpose. A colour is a label the reader assigns their own
    #: meaning to, and the set of them will grow.
    colour: str
    style: HighlightStyle = "highlight"
    quoted_text: str
    note: str | None = None


class PageHighlightUpdate(BaseModel):
    colour: str | None = None
    style: HighlightStyle | None = None
    note: str | None = None


class PageHighlightOut(BaseModel):
    id: str
    book_id: str
    user_id: str
    page: int
    rects: list[HighlightRect]
    colour: str
    style: HighlightStyle
    quoted_text: str
    note: str | None
    created_at: str
