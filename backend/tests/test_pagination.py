from app.services import pagination


def test_page_number_zero_words():
    assert pagination.page_number(0) == 1


def test_page_number_one_word():
    assert pagination.page_number(1) == 1


def test_page_number_exactly_275():
    assert pagination.page_number(275) == 2


def test_page_number_monotonic():
    pages = [pagination.page_number(w) for w in range(0, 2000, 37)]
    assert pages == sorted(pages)


def test_total_pages_zero_words():
    assert pagination.total_pages(0) == 0


def test_total_pages_rounds_up():
    assert pagination.total_pages(1) == 1
    assert pagination.total_pages(275) == 1
    assert pagination.total_pages(276) == 2


def test_percent_complete_zero_blocks():
    assert pagination.percent_complete(0, 0) == 0.0


def test_percent_complete_never_exceeds_100():
    assert pagination.percent_complete(999, 10) == 100.0


def test_percent_complete_first_block():
    assert pagination.percent_complete(0, 10) == 10.0


def test_percent_complete_last_block():
    assert pagination.percent_complete(9, 10) == 100.0
