"""SQLite storage. Plain sqlite3 + SQL so every query is visible; no ORM.

Data model (one row per thing, foreign keys between them):

  sessions  1 ──< videos  1 ──< tags
                          1 ──< rounds
                          1 ──< reviews   (combo confirm/reject decisions)

A video is identified the same way the browser app identifies it: file name + size + last-modified time
(a "fingerprint"), because browsers never reveal a file's path. Video files themselves are never stored.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "data" / "fightsmart.db"

SCHEMA_VERSION = 1
SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    date        TEXT,                                   -- ISO date, e.g. 2026-11-19
    kind        TEXT NOT NULL DEFAULT 'sparring' CHECK (kind IN ('sparring', 'scouting')),
    opponent    TEXT,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS videos (
    id             INTEGER PRIMARY KEY,
    session_id     INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    file_name      TEXT NOT NULL,
    size           INTEGER NOT NULL,
    last_modified  INTEGER NOT NULL,
    duration       REAL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (file_name, size, last_modified)
);

-- Tag and round ids come from the browser (UUIDs). They are unique per video, not globally,
-- because the same export file can be imported into two videos.
CREATE TABLE IF NOT EXISTS tags (
    video_id  INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    id        TEXT NOT NULL,
    time      REAL NOT NULL CHECK (time >= 0),
    label     TEXT NOT NULL,
    note      TEXT NOT NULL DEFAULT '',
    fighter   TEXT CHECK (fighter IN ('you', 'opponent')),
    outcome   TEXT CHECK (outcome IN ('landed', 'blocked', 'missed')),
    PRIMARY KEY (video_id, id)
);
CREATE INDEX IF NOT EXISTS tags_by_video_time ON tags (video_id, time);

CREATE TABLE IF NOT EXISTS rounds (
    video_id  INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    id        TEXT NOT NULL,
    start     REAL NOT NULL CHECK (start >= 0),
    "end"     REAL,
    PRIMARY KEY (video_id, id)
);

CREATE TABLE IF NOT EXISTS reviews (
    video_id  INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    combo_id  TEXT NOT NULL,
    status    TEXT NOT NULL CHECK (status IN ('confirmed', 'rejected')),
    PRIMARY KEY (video_id, combo_id)
);
"""


def db_path() -> Path:
    return Path(os.environ.get("FIGHTSMART_DB", DEFAULT_PATH))


def connect(path: Path | None = None) -> sqlite3.Connection:
    path = path or db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # SQLite ignores REFERENCES unless this is on
    conn.execute("PRAGMA journal_mode = WAL")  # safe concurrent reads while writing
    return conn


def init(conn: sqlite3.Connection) -> None:
    """Create tables if missing. user_version records the schema version for future migrations."""
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > SCHEMA_VERSION:
        raise RuntimeError(f"Database schema v{version} is newer than this server (v{SCHEMA_VERSION}).")
    conn.executescript(SCHEMA)
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """All-or-nothing: commit if the block succeeds, roll back if it raises."""
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
