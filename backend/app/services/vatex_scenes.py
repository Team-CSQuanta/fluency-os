"""Scenes from VATEX — YouTube clips with ten human descriptions each.

VATEX (Wang et al., ICCV 2019, CC BY 4.0) publishes annotations, not video:
every entry is a YouTube id, a start and end second, and ten independent
descriptions written by people who watched it. Those ten are why this is worth
having. A clip from the learner's own library has no ground truth at all; a
VATEX scene has ten, and ten is enough to tell a description that got the
scene right from one that merely sounds fluent.

See app/data/vatex_scenes.jsonl.gz — the whole public corpus: VATEX v1.0
training plus v1.1 validation and public test, 34,991 scenes, every one of them
carrying its full set of ten descriptions.
"""

import gzip
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from app.utils.time import iso8601_utc_ago, iso8601_utc_now

# Long enough that the wording of a scene has gone, short enough that the
# corpus does not have to be infinite. Sixty days over 34,991 scenes means the
# pool only tightens for a learner playing hundreds of rounds a week.
COOLDOWN_DAYS = 60

_PATH = Path(__file__).resolve().parent.parent / "data" / "vatex_scenes.jsonl.gz"
_IMPORT_MARKER = "vatex_scenes_imported"
_BATCH = 2000

_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]


@dataclass(frozen=True)
class Scene:
    video_id: str
    start_s: int
    end_s: int
    cefr: str
    captions: tuple[str, ...]

    @property
    def key(self) -> str:
        return f"{self.video_id}_{self.start_s}_{self.end_s}"


def _iter_file() -> "list[dict]":
    """Read the shipped corpus. Gzipped because 34,991 scenes with ten
    descriptions each is 32 MB of JSON and 7 MB compressed; gzip is in the
    standard library, so this costs no dependency."""
    if not _PATH.is_file():
        return []
    rows = []
    with gzip.open(_PATH, "rt", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            # The first line is the provenance header, not a scene.
            if "video_id" in record:
                rows.append(record)
    return rows


def ensure_imported(conn: sqlite3.Connection) -> int:
    """Load the corpus into the database, once.

    Marked in app_meta rather than inferred from the row count, so a learner
    who has had scenes removed does not trigger a silent re-import on every
    launch. Returns the number of scenes inserted.
    """
    done = conn.execute("SELECT value FROM app_meta WHERE key = ?", (_IMPORT_MARKER,)).fetchone()
    if done is not None:
        return 0

    # Do not mark an import that did not happen. _iter_file returns nothing
    # when the corpus file is missing, and writing the marker anyway left the
    # table permanently empty: every later launch saw the marker, skipped the
    # import, and the feature reported "you have worked through every scene"
    # to a learner who had been served none. Recovery meant deleting a row from
    # app_meta by hand.
    records = _iter_file()
    if not records:
        return 0

    inserted = 0
    batch: list[tuple] = []
    for record in records:
        batch.append(
            (
                record["video_id"],
                int(record["start_s"]),
                int(record["end_s"]),
                record["cefr"],
                json.dumps(record["captions"], ensure_ascii=False),
            )
        )
        if len(batch) >= _BATCH:
            conn.executemany(
                "INSERT INTO vatex_scenes (video_id, start_s, end_s, cefr, captions) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                batch,
            )
            inserted += len(batch)
            batch.clear()
    if batch:
        conn.executemany(
            "INSERT INTO vatex_scenes (video_id, start_s, end_s, cefr, captions) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
            batch,
        )
        inserted += len(batch)

    conn.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)", (_IMPORT_MARKER, iso8601_utc_now())
    )
    conn.commit()
    return inserted


def size(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) AS n FROM vatex_scenes").fetchone()["n"]


def _row_to_scene(row: sqlite3.Row) -> Scene:
    return Scene(
        video_id=row["video_id"],
        start_s=row["start_s"],
        end_s=row["end_s"],
        cefr=row["cefr"],
        captions=tuple(json.loads(row["captions"])),
    )


def band_window(level: str | None) -> set[str]:
    """Scenes at the learner's level and one step either side. A scene rated
    two bands above them is not practice, it is a wall."""
    if level not in _ORDER:
        return {"A1", "A2", "B1"}
    index = _ORDER.index(level)
    return {_ORDER[i] for i in range(max(0, index - 1), min(len(_ORDER), index + 2))}


def mark_unavailable(conn: sqlite3.Connection, video_id: str) -> None:
    conn.execute(
        "INSERT INTO vatex_unavailable (video_id, reported_at) VALUES (?, ?) "
        "ON CONFLICT(video_id) DO NOTHING",
        (video_id, iso8601_utc_now()),
    )


def pick(conn: sqlite3.Connection, *, user_id: str, level: str | None) -> Scene | None:
    """A scene at roughly the learner's level, whose video still plays, and
    which they have not been shown in the last COOLDOWN_DAYS.

    Three filters, and each excludes for a different reason:

    * **Reported gone** and **failed to play** are global. A video that has been
      deleted has been deleted for everyone, so nobody should meet it twice.
    * **Recently seen** is per learner and expires. A scene is worth describing
      again eventually — a second attempt months later is a genuine measure of
      progress — but not while the learner still remembers it. Sixty days is
      long enough that the wording has gone.

    Widens the CEFR band before it gives up, but never drops the cooldown: the
    earlier version's last resort ignored the seen-filter entirely, so a learner
    whose band was exhausted could be handed the same scene twice running.
    """
    wanted = sorted(band_window(level))
    placeholders = ",".join("?" for _ in wanted)
    cutoff = iso8601_utc_ago(days=COOLDOWN_DAYS)

    # The window is part of a scene's identity — one video can supply several
    # clips at different timestamps — so the cooldown matches on all three
    # columns rather than on video_id alone.
    base = """
        SELECT s.* FROM vatex_scenes s
         WHERE s.video_id NOT IN (SELECT video_id FROM vatex_unavailable)
           AND s.video_id NOT IN (SELECT video_id FROM vatex_playback_errors)
           AND NOT EXISTS (
                 SELECT 1 FROM challenge_rounds r
                  WHERE r.user_id = ?
                    AND r.video_id = s.video_id
                    AND r.start_s  = s.start_s
                    AND r.end_s    = s.end_s
                    AND r.started_at >= ?
               )
    """
    attempts = [
        (f"{base} AND s.cefr IN ({placeholders}) ORDER BY RANDOM() LIMIT 1", [user_id, cutoff, *wanted]),
        (f"{base} ORDER BY RANDOM() LIMIT 1", [user_id, cutoff]),
    ]
    for sql, params in attempts:
        row = conn.execute(sql, params).fetchone()
        if row is not None:
            return _row_to_scene(row)
    return None


def cooldown_state(conn: sqlite3.Connection, user_id: str) -> dict:
    """How much of the corpus is actually reachable right now, so the interface
    can say so instead of only discovering it at the moment it runs out."""
    total = size(conn)
    blocked = conn.execute(
        "SELECT COUNT(*) AS n FROM ("
        "  SELECT video_id FROM vatex_unavailable"
        "  UNION SELECT video_id FROM vatex_playback_errors) "
    ).fetchone()["n"]
    resting = conn.execute(
        "SELECT COUNT(DISTINCT video_id || '_' || start_s || '_' || end_s) AS n "
        "FROM challenge_rounds WHERE user_id = ? AND video_id IS NOT NULL AND started_at >= ?",
        (user_id, iso8601_utc_ago(days=COOLDOWN_DAYS)),
    ).fetchone()["n"]
    return {
        "total": total,
        "unavailable": blocked,
        "resting": resting,
        "available": max(0, total - blocked - resting),
        "cooldown_days": COOLDOWN_DAYS,
    }


def mark_playback_error(conn: sqlite3.Connection, video_id: str, reason: str = "") -> None:
    """Recorded when the player itself reports the video will not play.

    Separate from mark_unavailable, which is the learner pressing a button.
    This one needs no button: the embed raises an error, the page reports it,
    and the scene leaves the pool for everyone.
    """
    conn.execute(
        "INSERT INTO vatex_playback_errors (video_id, reason, reported_at) VALUES (?, ?, ?) "
        "ON CONFLICT(video_id) DO NOTHING",
        (video_id, reason[:120], iso8601_utc_now()),
    )


def embed_url(video_id: str, start_s: int, end_s: int) -> str:
    """A stripped embed the learner cannot steer, limited to the scene's own
    seconds.

    Every parameter here was checked by rendering the embed and looking at the
    result, because several of them do not do what their names suggest:

      controls=0        The only way to remove the title and channel name. They
                        are part of the player chrome, and "modestbranding"
                        does not touch them — an embed with controls showed
                        "Hängepartie, T4,5 Geocache · Klettern & Co" across the
                        top, which names the scene the learner is supposed to
                        describe. It also removes the seek bar, so the rest of
                        the video stays out of reach.
      enablejsapi=1     Lets the page drive playback by postMessage, since
                        there are no controls left to click. No script of
                        YouTube's is loaded and the page CSP is unchanged.
      start/end         Bound playback to the ten seconds the describers saw.
      disablekb=1       No keyboard seeking either.
      cc_load_policy=0  Requests captions off, and is NOT sufficient on its own:
                        auto-captions still appeared ("[Applause]" burned over
                        the picture). The renderer unloads the captions module
                        over postMessage as well.
    """
    return (
        f"https://www.youtube-nocookie.com/embed/{video_id}"
        f"?start={start_s}&end={end_s}"
        "&autoplay=0&controls=0&modestbranding=1&rel=0&iv_load_policy=3"
        "&cc_load_policy=0&fs=0&disablekb=1&enablejsapi=1&playsinline=1"
    )
