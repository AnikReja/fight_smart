"""Request/response shapes. Pydantic validates every request before it reaches the database,
so bad input becomes a clear 422 error instead of a crash or corrupt data."""
from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Fighter = Literal["you", "opponent"]
Outcome = Literal["landed", "blocked", "missed"]
ReviewStatus = Literal["confirmed", "rejected"]
SessionKind = Literal["sparring", "scouting"]


def _finite_non_negative(v: float) -> float:
    if not math.isfinite(v) or v < 0:
        raise ValueError("must be a finite number >= 0")
    return v


class Tag(BaseModel):
    id: str = Field(min_length=1, max_length=100, pattern=r"^[^:]+$")  # ':' separates ids inside combo ids
    time: float
    label: str = Field(min_length=1, max_length=40)
    note: str = Field(default="", max_length=500)
    fighter: Fighter | None = None
    outcome: Outcome | None = None

    _time = field_validator("time")(_finite_non_negative)


class Round(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    start: float
    end: float | None = None

    _start = field_validator("start")(_finite_non_negative)

    @model_validator(mode="after")
    def end_after_start(self) -> "Round":
        if self.end is not None and (not math.isfinite(self.end) or self.end <= self.start):
            raise ValueError("end must be after start")
        return self


class VideoData(BaseModel):
    """Same shape as the browser app's per-video data (and the tags/reviews/rounds of an export file)."""
    tags: list[Tag] = Field(default_factory=list, max_length=20_000)
    reviews: dict[str, ReviewStatus] = Field(default_factory=dict)
    rounds: list[Round] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def unique_ids(self) -> "VideoData":
        if len({t.id for t in self.tags}) != len(self.tags):
            raise ValueError("tag ids must be unique")
        if len({r.id for r in self.rounds}) != len(self.rounds):
            raise ValueError("round ids must be unique")
        return self


class SessionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    kind: SessionKind = "sparring"
    opponent: str | None = Field(default=None, max_length=120)
    notes: str = Field(default="", max_length=2000)


class SessionPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    kind: SessionKind | None = None
    opponent: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)


class VideoSummary(BaseModel):
    id: int
    session_id: int | None
    file_name: str
    size: int
    last_modified: int
    duration: float | None
    tag_count: int
    round_count: int


class Session(SessionIn):
    id: int
    created_at: str
    video_count: int = 0
    tag_count: int = 0


class SessionDetail(Session):
    videos: list[VideoSummary]


class VideoIn(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=0)
    last_modified: int = Field(ge=0)
    duration: float | None = None
    session_id: int | None = None


class VideoPatch(BaseModel):
    session_id: int | None = None
    duration: float | None = None
    # Distinguish "set session_id to null" from "don't change it".
    clear_session: bool = False


class SaveResult(BaseModel):
    tags: int
    rounds: int
    reviews: int
