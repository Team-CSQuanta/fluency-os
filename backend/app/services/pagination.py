"""Pure derived-number helpers for reading position (spec §7.1).

One page is defined as 275 words and is never stored as ground truth —
EPUB is reflowable and has no real pages, so "page N / M" is always
recomputed from cumulative word counts rather than a fixed layout.
"""

import math

WORDS_PER_PAGE = 275


def page_number(word_offset: int) -> int:
    """1-indexed page the given cumulative word offset falls on."""
    return max(1, word_offset // WORDS_PER_PAGE + 1)


def total_pages(total_words: int) -> int:
    if total_words <= 0:
        return 0
    return math.ceil(total_words / WORDS_PER_PAGE)


def pages_from_words(words: int) -> int:
    """Pages *read*, as opposed to the page a position falls on. Rounded so a
    day of short sessions still adds up to roughly what was actually read."""
    if words <= 0:
        return 0
    return round(words / WORDS_PER_PAGE)


def percent_complete(max_block_seen: int, total_blocks: int) -> float:
    """max_block_seen only ever increases (spec §7.1), so this is monotonic
    for a given book regardless of where the reader currently is."""
    if total_blocks <= 0:
        return 0.0
    pct = (max_block_seen + 1) / total_blocks * 100
    return min(100.0, max(0.0, round(pct, 1)))
