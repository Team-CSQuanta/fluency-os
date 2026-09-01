from pydantic import BaseModel


class BookImportRequest(BaseModel):
    user_id: str
    paths: list[str]
    count_toward_goal: bool = True
    heat_overlay: bool = True


class BookOut(BaseModel):
    id: str
    user_id: str
    title: str
    author: str | None
    language: str
    format: str
    cover_path: str | None
    total_blocks: int
    total_words: int
    page_estimate: int
    ingest_status: str
    ingest_error: str | None
    count_toward_goal: bool
    heat_overlay: bool
    imported_at: str
    finished_at: str | None
    # Populated by the list endpoint's join on reading_positions: null means
    # the book has never been opened, which is what "Not started" means.
    last_read_at: str | None = None
    percent: float = 0.0


class BookCountsOut(BaseModel):
    all: int
    reading: int
    not_started: int
    finished: int


class BookUpdate(BaseModel):
    title: str | None = None
    author: str | None = None
    language: str | None = None
    count_toward_goal: bool | None = None
    heat_overlay: bool | None = None
    # A bool rather than the timestamp itself: the client says "I finished
    # this", the server decides when that was. Setting it false reopens the
    # book, which is what the Finished filter's counterpart needs.
    finished: bool | None = None


class ChapterOut(BaseModel):
    id: str
    order_index: int
    label: str
    depth: int
    start_block: int
    page: int


class BlockOut(BaseModel):
    block_index: int
    chapter_id: str | None
    kind: str
    text: str
    word_count: int


class PositionOut(BaseModel):
    block_index: int
    char_offset: int
    max_block_seen: int
    page: int
    total_pages: int
    percent: float


class PositionUpdate(BaseModel):
    user_id: str
    block_index: int
    char_offset: int = 0


class PageOut(BaseModel):
    page: int
    total_pages: int
    blocks: list[BlockOut]
    has_prev: bool
    has_next: bool
    first_block_index: int
