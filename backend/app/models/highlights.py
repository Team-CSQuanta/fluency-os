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
