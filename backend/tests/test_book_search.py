from app.services.book_search import SNIPPET_END, SNIPPET_START, SnippetSegment, build_match_query, parse_snippet


def test_build_match_query_simple_word():
    assert build_match_query("reticent") == '"reticent"'


def test_build_match_query_multiple_words():
    assert build_match_query("reticent about") == '"reticent" "about"'


def test_build_match_query_empty_and_whitespace():
    assert build_match_query("") is None
    assert build_match_query("   ") is None
    assert build_match_query("!!!") is None


def test_build_match_query_strips_apostrophes_safely():
    # "don't" -> two literal tokens, not a syntax-breaking apostrophe.
    assert build_match_query("don't") == '"don" "t"'


def test_build_match_query_neutralises_fts_operators():
    # AND/OR/NOT/NEAR would be real FTS5 operators unquoted — quoting makes
    # them literal search terms instead, so a book containing the word
    # "AND" can still be found, and no operator injection is possible.
    result = build_match_query("AND OR NOT NEAR")
    assert result == '"AND" "OR" "NOT" "NEAR"'


def test_build_match_query_neutralises_injection_attempt():
    result = build_match_query('"; DROP TABLE books; --')
    # No unescaped double-quote or bareword operator survives — every
    # token is individually quoted.
    assert result is not None
    assert result.count('"') % 2 == 0
    assert "DROP" in result and '"DROP"' in result


def test_build_match_query_escapes_internal_quotes():
    result = build_match_query('he said "hello"')
    assert result is not None
    # Regex tokenisation on \w+ already strips the quote characters from the
    # tokens themselves, so nothing needs escaping here — but this asserts
    # the output stays well-formed regardless.
    assert result.count('"') % 2 == 0


def test_parse_snippet_no_matches():
    assert parse_snippet("plain text with no markers") == [SnippetSegment("plain text with no markers", False)]


def test_parse_snippet_single_match():
    raw = f"before {SNIPPET_START}word{SNIPPET_END} after"
    segments = parse_snippet(raw)
    assert [(s.text, s.matched) for s in segments] == [
        ("before ", False),
        ("word", True),
        (" after", False),
    ]


def test_parse_snippet_multiple_matches():
    raw = f"{SNIPPET_START}one{SNIPPET_END} two {SNIPPET_START}three{SNIPPET_END}"
    segments = parse_snippet(raw)
    assert [(s.text, s.matched) for s in segments] == [
        ("one", True),
        (" two ", False),
        ("three", True),
    ]
