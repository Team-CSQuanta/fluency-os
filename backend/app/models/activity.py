from pydantic import BaseModel


class DayActivityOut(BaseModel):
    """One calendar square."""

    date: str
    pages: int
    minutes: int
    reviews: int


class ActivityOut(BaseModel):
    """The consistency calendar: every day in the window, gaps included."""

    days: list[DayActivityOut]
    total_pages: int
    total_reviews: int
    #: Days with anything on them at all — the number under the calendar.
    active_days: int
