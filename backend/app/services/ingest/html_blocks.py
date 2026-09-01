"""The shared XHTML → blocks walker.

EPUB is a zip of XHTML documents; MOBI/AZW3 unpack into HTML. Both therefore
reduce to the same problem — walk markup in document order, map each
block-level tag to a block kind, and record headings as chapters — so both
formats share this walker rather than each growing its own.
"""

from lxml import html as lxml_html

from app.services.ingest.base import ParsedBlock, ParsedChapter

BLOCK_TAGS = {
    "p": "p",
    "h1": "h1",
    "h2": "h2",
    "h3": "h3",
    "h4": "h3",
    "h5": "h3",
    "h6": "h3",
    "blockquote": "quote",
    "li": "list",
    "figcaption": "caption",
    "pre": "code",
}
HEADING_DEPTH = {"h1": 0, "h2": 1, "h3": 2}

# Markup that contains text but is not prose. Left in, a stylesheet or a
# script body would be ingested as a paragraph and then indexed for search.
_SKIP_TAGS = {"script", "style", "head", "title"}


def walk_html(
    content: bytes,
    *,
    blocks: list[ParsedBlock],
    chapters: list[ParsedChapter],
    word_offset: int,
) -> int:
    """Appends every block found in `content` to `blocks` (and every heading to
    `chapters`), returning the running cumulative word offset.

    `blocks` and `chapters` are appended to in place because a book is a
    single flat block list spanning many documents — block_index and
    word_offset have to keep counting across file boundaries.
    """
    try:
        tree = lxml_html.fromstring(content)
    except Exception:
        # One unparseable document shouldn't fail the whole book; the caller
        # keeps going with the rest of the spine.
        return word_offset

    for element in tree.iter(*BLOCK_TAGS.keys()):
        if any(ancestor.tag in _SKIP_TAGS for ancestor in element.iterancestors()):
            continue

        text = " ".join("".join(element.itertext()).split())
        if not text:
            continue

        tag = element.tag
        kind = BLOCK_TAGS[tag]
        word_count = len(text.split())

        if tag in HEADING_DEPTH:
            chapters.append(
                ParsedChapter(
                    label=text,
                    depth=HEADING_DEPTH[tag],
                    start_block=len(blocks),
                    word_offset=word_offset,
                )
            )

        blocks.append(ParsedBlock(kind=kind, text=text, word_count=word_count))
        word_offset += word_count

    return word_offset
