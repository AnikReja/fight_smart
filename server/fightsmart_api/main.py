"""REST API for the FightSmart app.

  GET    /api/health
  GET    /api/sessions                    list (with video/tag counts)
  POST   /api/sessions                    create
  GET    /api/sessions/{id}               one session + its videos
  PATCH  /api/sessions/{id}               edit
  DELETE /api/sessions/{id}               delete (its videos are kept, unassigned)
  POST   /api/videos                      register a video by fingerprint (idempotent: returns the existing one)
  GET    /api/videos?session_id=          list videos
  PATCH  /api/videos/{id}                 assign to a session / set duration
  GET    /api/videos/{id}/data            tags, rounds, combo decisions
  PUT    /api/videos/{id}/data            replace them (one transaction)

Run:  .venv/Scripts/python -m uvicorn fightsmart_api.main:create_app --factory --port 8000
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response

from . import db
from .models import (SaveResult, Session, SessionDetail, SessionIn, SessionPatch, VideoData, VideoIn,
                     VideoPatch, VideoSummary)

API_VERSION = "1"

SESSION_LIST_SQL = """
SELECT s.*,
       (SELECT COUNT(*) FROM videos v WHERE v.session_id = s.id) AS video_count,
       (SELECT COUNT(*) FROM tags t JOIN videos v ON v.id = t.video_id WHERE v.session_id = s.id) AS tag_count
FROM sessions s
"""

VIDEO_LIST_SQL = """
SELECT v.*,
       (SELECT COUNT(*) FROM tags t WHERE t.video_id = v.id) AS tag_count,
       (SELECT COUNT(*) FROM rounds r WHERE r.video_id = v.id) AS round_count
FROM videos v
"""


def create_app(path: Path | None = None) -> FastAPI:
    app = FastAPI(title="FightSmart API", version=API_VERSION)
    conn = db.connect(path)
    db.init(conn)
    lock = threading.Lock()  # one shared connection; serialize access across request threads

    def session_or_404(session_id: int) -> sqlite3.Row:
        row = conn.execute(SESSION_LIST_SQL + " WHERE s.id = ?", (session_id,)).fetchone()
        if row is None:
            raise HTTPException(404, f"Session {session_id} not found")
        return row

    def video_or_404(video_id: int) -> sqlite3.Row:
        row = conn.execute(VIDEO_LIST_SQL + " WHERE v.id = ?", (video_id,)).fetchone()
        if row is None:
            raise HTTPException(404, f"Video {video_id} not found")
        return row

    def check_session_exists(session_id: int | None) -> None:
        if session_id is not None and conn.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is None:
            raise HTTPException(422, f"Session {session_id} does not exist")

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True, "version": API_VERSION}

    # ---- sessions -------------------------------------------------------

    @app.get("/api/sessions", response_model=list[Session])
    def list_sessions() -> list[dict]:
        with lock:
            rows = conn.execute(SESSION_LIST_SQL + " ORDER BY COALESCE(s.date, s.created_at) DESC, s.id DESC").fetchall()
        return [dict(r) for r in rows]

    @app.post("/api/sessions", response_model=Session, status_code=201)
    def create_session(body: SessionIn) -> dict:
        with lock, db.transaction(conn):
            cur = conn.execute(
                "INSERT INTO sessions (name, date, kind, opponent, notes) VALUES (?, ?, ?, ?, ?)",
                (body.name, body.date, body.kind, body.opponent, body.notes))
            return dict(session_or_404(cur.lastrowid))

    @app.get("/api/sessions/{session_id}", response_model=SessionDetail)
    def get_session(session_id: int) -> dict:
        with lock:
            session = dict(session_or_404(session_id))
            videos = conn.execute(VIDEO_LIST_SQL + " WHERE v.session_id = ? ORDER BY v.id", (session_id,)).fetchall()
        return {**session, "videos": [dict(v) for v in videos]}

    @app.patch("/api/sessions/{session_id}", response_model=Session)
    def update_session(session_id: int, body: SessionPatch) -> dict:
        changes = body.model_dump(exclude_unset=True)
        with lock, db.transaction(conn):
            session_or_404(session_id)
            if changes:
                # Column names come from the Pydantic model, never from user input, so this is injection-safe.
                assignments = ", ".join(f"{k} = ?" for k in changes)
                conn.execute(f"UPDATE sessions SET {assignments} WHERE id = ?", (*changes.values(), session_id))
            return dict(session_or_404(session_id))

    @app.delete("/api/sessions/{session_id}", status_code=204)
    def delete_session(session_id: int) -> Response:
        with lock, db.transaction(conn):
            session_or_404(session_id)
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))  # videos: ON DELETE SET NULL
        return Response(status_code=204)

    # ---- videos ---------------------------------------------------------

    @app.post("/api/videos", response_model=VideoSummary)
    def register_video(body: VideoIn, response: Response) -> dict:
        """Find a video by fingerprint or create it. Calling twice is safe (idempotent)."""
        with lock, db.transaction(conn):
            check_session_exists(body.session_id)
            row = conn.execute("SELECT id FROM videos WHERE file_name = ? AND size = ? AND last_modified = ?",
                               (body.file_name, body.size, body.last_modified)).fetchone()
            if row is None:
                cur = conn.execute(
                    "INSERT INTO videos (session_id, file_name, size, last_modified, duration) VALUES (?, ?, ?, ?, ?)",
                    (body.session_id, body.file_name, body.size, body.last_modified, body.duration))
                response.status_code = 201
                return dict(video_or_404(cur.lastrowid))
            if body.duration is not None:
                conn.execute("UPDATE videos SET duration = ? WHERE id = ?", (body.duration, row["id"]))
            return dict(video_or_404(row["id"]))

    @app.get("/api/videos", response_model=list[VideoSummary])
    def list_videos(session_id: int | None = None) -> list[dict]:
        with lock:
            if session_id is None:
                rows = conn.execute(VIDEO_LIST_SQL + " ORDER BY v.id").fetchall()
            else:
                rows = conn.execute(VIDEO_LIST_SQL + " WHERE v.session_id = ? ORDER BY v.id", (session_id,)).fetchall()
        return [dict(r) for r in rows]

    @app.patch("/api/videos/{video_id}", response_model=VideoSummary)
    def update_video(video_id: int, body: VideoPatch) -> dict:
        with lock, db.transaction(conn):
            video_or_404(video_id)
            if body.clear_session:
                conn.execute("UPDATE videos SET session_id = NULL WHERE id = ?", (video_id,))
            elif body.session_id is not None:
                check_session_exists(body.session_id)
                conn.execute("UPDATE videos SET session_id = ? WHERE id = ?", (body.session_id, video_id))
            if body.duration is not None:
                conn.execute("UPDATE videos SET duration = ? WHERE id = ?", (body.duration, video_id))
            return dict(video_or_404(video_id))

    @app.get("/api/videos/{video_id}/data", response_model=VideoData, response_model_exclude_none=True)
    def get_video_data(video_id: int) -> dict:
        with lock:
            video_or_404(video_id)
            tags = conn.execute("SELECT id, time, label, note, fighter, outcome FROM tags WHERE video_id = ? ORDER BY time, id",
                                (video_id,)).fetchall()
            rounds = conn.execute('SELECT id, start, "end" FROM rounds WHERE video_id = ? ORDER BY start', (video_id,)).fetchall()
            reviews = conn.execute("SELECT combo_id, status FROM reviews WHERE video_id = ?", (video_id,)).fetchall()
        return {
            # Omit null optional fields so the shape matches the browser app's JSON exactly.
            "tags": [{k: v for k, v in dict(t).items() if v is not None} for t in tags],
            "rounds": [{k: v for k, v in dict(r).items() if v is not None} for r in rounds],
            "reviews": {r["combo_id"]: r["status"] for r in reviews},
        }

    @app.put("/api/videos/{video_id}/data", response_model=SaveResult)
    def save_video_data(video_id: int, body: VideoData) -> dict:
        """Replace everything for this video in one transaction: either all of it saves or none of it does."""
        with lock, db.transaction(conn):
            video_or_404(video_id)
            for table in ("tags", "rounds", "reviews"):
                conn.execute(f"DELETE FROM {table} WHERE video_id = ?", (video_id,))
            conn.executemany(
                "INSERT INTO tags (video_id, id, time, label, note, fighter, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(video_id, t.id, t.time, t.label, t.note, t.fighter, t.outcome) for t in body.tags])
            conn.executemany('INSERT INTO rounds (video_id, id, start, "end") VALUES (?, ?, ?, ?)',
                             [(video_id, r.id, r.start, r.end) for r in body.rounds])
            conn.executemany("INSERT INTO reviews (video_id, combo_id, status) VALUES (?, ?, ?)",
                             [(video_id, k, v) for k, v in body.reviews.items()])
        return {"tags": len(body.tags), "rounds": len(body.rounds), "reviews": len(body.reviews)}

    app.state.conn = conn
    return app

