"""The watching library: importing files, listing them, tracking progress.

Import deliberately does two things in two phases. The request-time phase is
cheap and synchronous (hash, insert a queued row) so the card appears the
instant the user picks a file; the background phase is the expensive one
(ffprobe, thumbnail, demuxing every embedded subtitle track) and reports its
outcome through ingest_status the same way book ingestion does.
"""

import sqlite3
from pathlib import Path

from app.services import vocabulary
from app.services.media import ffmpeg, probe as probe_mod, storage, subtitles, tracks
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

# Preference order when auto-selecting the target-language track: a real
# English track beats an untagged one, and any text track beats nothing.
_TARGET_LANGS = ("en", "eng")


def _now() -> str:
    return iso8601_utc_now()


def find_existing(conn: sqlite3.Connection, user_id: str, file_hash: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM media_items WHERE user_id = ? AND file_hash = ?", (user_id, file_hash)
    ).fetchone()


def title_from_filename(path: Path) -> str:
    """A watchable title out of a release filename.

    "Arrival.2016.1080p.BluRay.x264-GROUP.mkv" is the normal shape of a file
    people actually have, and showing that verbatim on a card makes the
    library unreadable. Everything from the first release-marker token on is
    dropped, dots become spaces, and a trailing year is kept because it
    distinguishes remakes.
    """
    stem = path.stem
    markers = (
        "1080p", "720p", "2160p", "480p", "4k", "uhd", "bluray", "blu-ray", "brrip", "bdrip",
        "webrip", "web-dl", "webdl", "hdrip", "dvdrip", "hdtv", "x264", "x265", "h264", "h265",
        "hevc", "xvid", "aac", "ac3", "dts", "remux", "proper", "repack", "extended",
    )
    tokens = [t for t in stem.replace("_", " ").replace(".", " ").split() if t]
    kept: list[str] = []
    for token in tokens:
        if token.lower().strip("[]()-") in markers:
            break
        kept.append(token)
    if not kept:
        kept = tokens[:1] or [stem]

    year = None
    if len(kept) > 1 and kept[-1].strip("()").isdigit() and len(kept[-1].strip("()")) == 4:
        year = kept[-1].strip("()")
        kept = kept[:-1]

    title = " ".join(kept).strip(" -–—[](){}")
    return f"{title} ({year})" if year else (title or stem)


def create_queued(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    source_path: Path,
    file_hash: str,
    title: str | None = None,
) -> str:
    media_id = uuid7()
    conn.execute(
        """
        INSERT INTO media_items (id, user_id, title, kind, source_path, file_hash, file_bytes,
                                 ingest_status, added_at)
        VALUES (?, ?, ?, 'local', ?, ?, ?, 'queued', ?)
        """,
        (
            media_id,
            user_id,
            title or title_from_filename(source_path),
            str(source_path),
            file_hash,
            source_path.stat().st_size,
            _now(),
        ),
    )
    return media_id


def create_failed(conn: sqlite3.Connection, *, user_id: str, raw_path: str, reason: str) -> str:
    """A card for a file we could not read, rather than a silently dropped
    import. Mirrors books.import_books — the user picked this file and is
    owed an explanation attached to it."""
    media_id = uuid7()
    conn.execute(
        """
        INSERT INTO media_items (id, user_id, title, kind, source_path, file_hash, file_bytes,
                                 ingest_status, ingest_error, source_missing, added_at)
        VALUES (?, ?, ?, 'local', ?, ?, 0, 'failed', ?, 1, ?)
        """,
        (media_id, user_id, Path(raw_path).stem or raw_path, raw_path, f"missing:{media_id}", reason, _now()),
    )
    return media_id


def run_ingest(conn: sqlite3.Connection, media_id: str) -> None:
    """Probe the file, cut a thumbnail, register and extract subtitle tracks.

    Each subtitle extraction is wrapped individually: one track with a broken
    codec must not cost the file its other tracks, and it certainly must not
    cost it its `ready` status — the video is playable either way.
    """
    row = conn.execute("SELECT * FROM media_items WHERE id = ?", (media_id,)).fetchone()
    if row is None:
        return
    path = Path(row["source_path"])

    conn.execute("UPDATE media_items SET ingest_status = 'probing', ingest_error = NULL WHERE id = ?", (media_id,))
    conn.commit()

    try:
        info = probe_mod.probe(path)
    except (ffmpeg.FfmpegUnavailable, ffmpeg.FfmpegFailed) as err:
        conn.execute(
            "UPDATE media_items SET ingest_status = 'failed', ingest_error = ? WHERE id = ?", (str(err)[:500], media_id)
        )
        conn.commit()
        return

    # 10% in, so the frame is past distributor logos and black leader.
    thumb = probe_mod.extract_thumbnail(path, media_id, at_ms=int(info.duration_ms * 0.1) or 1000)

    conn.execute(
        """
        UPDATE media_items
           SET duration_ms = ?, width = ?, height = ?, video_codec = ?, audio_codec = ?,
               container = ?, thumbnail_path = ?, source_missing = 0, index_at_end = ?
         WHERE id = ?
        """,
        (
            info.duration_ms,
            info.width,
            info.height,
            info.video_codec,
            info.audio_codec,
            info.container,
            str(thumb) if thumb else None,
            int(probe_mod.index_at_end(path)),
            media_id,
        ),
    )
    tracks.register_streams(conn, media_id, info)
    conn.commit()

    for track_row in conn.execute(
        "SELECT * FROM media_tracks WHERE media_item_id = ? AND kind = 'subtitle' AND status = 'queued'",
        (media_id,),
    ).fetchall():
        try:
            tracks.extract_embedded(conn, track_row, path)
        except (ffmpeg.FfmpegUnavailable, ffmpeg.FfmpegFailed, subtitles.SubtitleParseError) as err:
            tracks.set_failed(conn, track_row["id"], str(err))
        conn.commit()

    for sidecar in tracks.find_sidecars(path):
        try:
            tracks.import_sidecar(conn, media_item_id=media_id, path=sidecar)
        except (OSError, subtitles.SubtitleParseError):
            continue
        conn.commit()

    _auto_select_tracks(conn, media_id)
    # Moments captured from this file before it last left the library.
    vocabulary.relink_clip_contexts(
        conn, media_item_id=media_id, file_hash=row["file_hash"], user_id=row["user_id"]
    )
    conn.execute("UPDATE media_items SET ingest_status = 'ready' WHERE id = ?", (media_id,))
    conn.commit()


def _auto_select_tracks(conn: sqlite3.Connection, media_id: str) -> None:
    """Pick the target and native tracks so the player opens with subtitles on.

    Choosing nothing and letting the user pick would be defensible for one
    file and tedious for a library. The native track is only auto-selected
    when there is an unambiguous second language — guessing wrongly there puts
    an incomprehensible second line on screen.
    """
    rows = conn.execute(
        "SELECT * FROM media_tracks WHERE media_item_id = ? AND kind = 'subtitle' AND cue_count > 0 "
        "ORDER BY CASE origin WHEN 'sidecar' THEN 0 WHEN 'embedded' THEN 1 ELSE 2 END, created_at",
        (media_id,),
    ).fetchall()
    if not rows:
        return

    target = next((r for r in rows if (r["language"] or "") in _TARGET_LANGS), None) or rows[0]
    others = [r for r in rows if r["id"] != target["id"] and (r["language"] or "") not in _TARGET_LANGS]
    native = others[0] if len(others) == 1 else None

    conn.execute(
        """
        INSERT INTO media_item_prefs (media_item_id, target_track_id, native_track_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(media_item_id) DO UPDATE SET
          target_track_id = COALESCE(media_item_prefs.target_track_id, excluded.target_track_id),
          native_track_id = COALESCE(media_item_prefs.native_track_id, excluded.native_track_id),
          updated_at = excluded.updated_at
        """,
        (media_id, target["id"], native["id"] if native else None, _now()),
    )
    if native is not None:
        conn.execute("UPDATE media_tracks SET role = 'native' WHERE id = ?", (native["id"],))


# One projection for every read of a library row, so a card in the grid, a
# card in "continue watching" and the player's own header all agree about what
# an item is. `{where}` is filled with a real clause, never string-patched
# after the fact.
_LIST_SELECT_TEMPLATE = """
    SELECT m.*,
           p.position_ms, p.percent_complete, p.total_watch_ms, p.updated_at AS last_watched_at,
           (SELECT COUNT(*) FROM media_clips c WHERE c.media_item_id = m.id) AS saves,
           (SELECT COUNT(*) FROM media_tracks t
             WHERE t.media_item_id = m.id AND t.kind = 'subtitle' AND t.cue_count > 0) AS subtitle_tracks
      FROM media_items m
      LEFT JOIN media_progress p ON p.media_item_id = m.id
     WHERE {where}
"""

_LIST_SELECT = _LIST_SELECT_TEMPLATE.format(where="m.user_id = ?")
_ONE_SELECT = _LIST_SELECT_TEMPLATE.format(where="m.id = ?")


def list_items(
    conn: sqlite3.Connection, user_id: str, *, scope: str = "all", query: str | None = None
) -> list[sqlite3.Row]:
    sql = _LIST_SELECT
    params: list[object] = [user_id]

    if scope == "local":
        sql += " AND m.kind = 'local'"
    elif scope == "link":
        sql += " AND m.kind = 'link'"
    elif scope == "unfinished":
        # Started but not finished. A file at 0% was never opened, and one at
        # 99%+ is done as far as a viewer is concerned — neither is "carry on".
        sql += " AND COALESCE(p.percent_complete, 0) > 0 AND COALESCE(p.percent_complete, 0) < 99"
    elif scope == "unwatched":
        sql += " AND COALESCE(p.percent_complete, 0) = 0"
    elif scope == "no-subs":
        sql += " AND (SELECT COUNT(*) FROM media_tracks t WHERE t.media_item_id = m.id" \
               " AND t.kind = 'subtitle' AND t.cue_count > 0) = 0"

    if query:
        sql += " AND LOWER(m.title) LIKE ?"
        params.append(f"%{query.lower()}%")

    sql += " ORDER BY COALESCE(p.updated_at, m.added_at) DESC"
    return conn.execute(sql, params).fetchall()


def counts(conn: sqlite3.Connection, user_id: str) -> dict[str, int]:
    return {
        scope: len(list_items(conn, user_id, scope=scope))
        for scope in ("all", "local", "link", "unfinished", "unwatched", "no-subs")
    }


def recent(conn: sqlite3.Connection, user_id: str, *, limit: int = 4) -> list[sqlite3.Row]:
    """Continue watching. Finished items are excluded — offering to resume
    something at 100% is the list telling the user something they know."""
    return conn.execute(
        _LIST_SELECT
        + " AND p.updated_at IS NOT NULL AND COALESCE(p.percent_complete, 0) < 99"
        + " ORDER BY p.updated_at DESC LIMIT ?",
        (user_id, limit),
    ).fetchall()


def get_item(conn: sqlite3.Connection, media_id: str) -> sqlite3.Row | None:
    return conn.execute(_ONE_SELECT, (media_id,)).fetchone()


def refresh_source_state(conn: sqlite3.Connection, row: sqlite3.Row) -> bool:
    """Check the file is still where we left it. Returns True if missing.

    Run on open rather than on a timer: the library holds paths into removable
    drives and network mounts, and the only moment the answer matters is the
    moment someone presses play.
    """
    missing = not (row["source_path"] and Path(row["source_path"]).is_file())
    if bool(row["source_missing"]) != missing:
        conn.execute("UPDATE media_items SET source_missing = ? WHERE id = ?", (int(missing), row["id"]))
        conn.commit()
    return missing


def relink(conn: sqlite3.Connection, media_id: str, new_path: Path) -> None:
    conn.execute(
        "UPDATE media_items SET source_path = ?, source_missing = 0, ingest_error = NULL WHERE id = ?",
        (str(new_path), media_id),
    )


def save_progress(
    conn: sqlite3.Connection,
    *,
    media_id: str,
    user_id: str,
    position_ms: int,
    watched_delta_ms: int,
    duration_ms: int,
) -> sqlite3.Row:
    percent = round(min(100.0, (position_ms / duration_ms) * 100), 2) if duration_ms > 0 else 0.0
    conn.execute(
        """
        INSERT INTO media_progress (media_item_id, user_id, position_ms, percent_complete, total_watch_ms, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(media_item_id) DO UPDATE SET
          position_ms = excluded.position_ms,
          percent_complete = excluded.percent_complete,
          total_watch_ms = media_progress.total_watch_ms + ?,
          updated_at = excluded.updated_at
        """,
        (media_id, user_id, position_ms, percent, max(0, watched_delta_ms), _now(), max(0, watched_delta_ms)),
    )
    return conn.execute("SELECT * FROM media_progress WHERE media_item_id = ?", (media_id,)).fetchone()


def delete_item(conn: sqlite3.Connection, media_id: str) -> None:
    """Remove the library entry and everything this app generated for it.

    The source video is never touched — it is the user's file, sitting where
    they put it, and deleting a library card is not a request to delete a film.
    """
    generated = [
        r["p"]
        for r in conn.execute(
            "SELECT thumbnail_path AS p FROM media_items WHERE id = ?1"
            " UNION ALL SELECT source_path FROM media_tracks WHERE media_item_id = ?1 AND origin != 'sidecar'"
            " UNION ALL SELECT clip_path FROM media_clips WHERE media_item_id = ?1"
            " UNION ALL SELECT thumb_path FROM media_clips WHERE media_item_id = ?1",
            (media_id,),
        ).fetchall()
    ]
    # Sidecar tracks keep a normalised copy of their own under subtitles/;
    # it lives beside the extracted ones and is ours to remove.
    for row in conn.execute(
        "SELECT id FROM media_tracks WHERE media_item_id = ? AND origin = 'sidecar'", (media_id,)
    ).fetchall():
        generated.append(str(storage.subtitles_dir() / f"{row['id']}.vtt"))

    conn.execute("DELETE FROM media_items WHERE id = ?", (media_id,))
    storage.delete_files(*generated)


def backfill_index_at_end(conn: sqlite3.Connection) -> int:
    """Flag already-imported files whose MP4 index sits at the end.

    The flag is written during ingest, so anything imported before the column
    existed reads as fine — which hides the offer to fix it from exactly the
    large old files most likely to need it.

    Runs once, marked in app_meta, because the answer only changes when a file
    is re-imported or rewritten and both of those set it themselves. Checking
    costs a couple of disk seeks per file; doing it on every launch would be a
    library-sized cost for an answer that does not move.
    """
    done = conn.execute("SELECT value FROM app_meta WHERE key = 'index_at_end_backfilled'").fetchone()
    if done is not None:
        return 0

    flagged = 0
    for row in conn.execute(
        "SELECT id, source_path FROM media_items WHERE kind = 'local' AND index_at_end = 0"
    ).fetchall():
        path = Path(row["source_path"]) if row["source_path"] else None
        # A file on an unplugged drive reads as fine rather than as broken:
        # index_at_end already returns False when it cannot open the file, and
        # offering to rewrite something we could not read would be wrong.
        if path is None or not path.is_file():
            continue
        if probe_mod.index_at_end(path):
            conn.execute("UPDATE media_items SET index_at_end = 1 WHERE id = ?", (row["id"],))
            flagged += 1

    conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('index_at_end_backfilled', ?)", (_now(),))
    conn.commit()
    return flagged
