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
    # Whether this book has original pages to render. Only PDFs do —
    # everything else is reflowable and never had a page to begin with.
    has_page_images: bool = False


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


class PageWordOut(BaseModel):
    """One word, boxed, in the rendered page image's own pixels.

    Short names because a dense page carries two or three thousand of these
    and the JSON is on the critical path for turning a page.
    """

    x: float
    y: float
    w: float
    h: float
    t: str
    #: Which line of the page it belongs to. The browser needs this to know
    #: where one line ends and the next begins — without it, selecting across
    #: a line break yields two words run together with no space.
    ln: int


class PageWordHeatOut(BaseModel):
    """One boxed word on a printed page that is above the reader's level."""

    #: Position in the page text layer's own word list, which is what the
    #: client already holds and draws from. Sending the box again would
    #: double the payload of the densest pages for nothing.
    i: int
    #: The hard word inside the box, which is not always the whole box: it is
    #: what the tooltip names and what a lookup would ask about.
    word: str
    cefr: str
    simpler: str | None = None


class PageHeatOut(BaseModel):
    """Difficulty heat for one printed page (the tint the reflowed view has
    always had, answered in page coordinates)."""

    target_cefr: str
    #: False when the book's own heat overlay flag is off, so the client can
    #: tell "nothing is hard here" from "this book opted out".
    enabled: bool
    words: list[PageWordHeatOut]
    total_above_level: int


class PageTextLayerOut(BaseModel):
    """The selectable text sitting over a rendered page.

    A rendered page is a picture. Everything a reader expects to be able to do
    to text — select it, look a word up, highlight it, copy it — needs to know
    where the words are, and a picture does not say. This is what a PDF viewer
    builds invisibly over the page, and it is why text in one can be selected
    at all.
    """

    #: The image these coordinates belong to, so the client can scale the
    #: layer to however wide it ends up drawing the page.
    width: float
    height: float
    words: list[PageWordOut]


class PageLabelCreate(BaseModel):
    user_id: str
    page: int
    rects: list[dict]
    original_text: str
    simple_text: str
    mode: str


class PageLabelOut(BaseModel):
    """A passage on the page, shown in plainer words."""

    id: str
    book_id: str
    page: int
    rects: list[dict]
    original_text: str
    simple_text: str
    mode: str
    created_at: str
