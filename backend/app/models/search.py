from pydantic import BaseModel


class SnippetSegmentOut(BaseModel):
    text: str
    matched: bool


class SearchHitOut(BaseModel):
    block_index: int
    page: int
    chapter_label: str | None
    snippet: list[SnippetSegmentOut]
