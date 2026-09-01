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
