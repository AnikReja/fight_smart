"""Step 4: measure punch-candidate detection against hand-labeled FightSmart tags.

Event-level matching: a prediction is a TRUE POSITIVE if it can be paired with a labeled punch by the same
fighter within `tolerance` seconds. Each label and each prediction can be used at most once (greedy by time
difference, closest pairs first).

  precision = TP / (TP + FP)   "when it says punch, how often is it right?"
  recall    = TP / (TP + FN)   "of the real punches, how many did it find?"
  F1        = harmonic mean of the two

Only the time range covered by labels is evaluated: predictions outside it can't be judged.
Human tags lag the real moment (reaction time), so we also report the median signed offset of matches.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

PUNCHES = {"Jab", "Cross", "Hook", "Uppercut"}


@dataclass
class Event:
    time: float
    fighter: str


@dataclass
class Scores:
    tp: int
    fp: int
    fn: int
    precision: float | None
    recall: float | None
    f1: float | None
    median_offset: float | None  # prediction time - label time, seconds
    matches: list[tuple[float, float]]  # (label time, prediction time)


def match_events(labels: list[Event], predictions: list[Event], tolerance: float) -> list[tuple[int, int]]:
    """One-to-one matching by smallest |time difference|, same fighter only."""
    pairs = [
        (abs(p.time - l.time), li, pi)
        for li, l in enumerate(labels)
        for pi, p in enumerate(predictions)
        if l.fighter == p.fighter and abs(p.time - l.time) <= tolerance
    ]
    pairs.sort()
    used_l, used_p, out = set(), set(), []
    for _, li, pi in pairs:
        if li not in used_l and pi not in used_p:
            used_l.add(li)
            used_p.add(pi)
            out.append((li, pi))
    return out


def score(labels: list[Event], predictions: list[Event], tolerance: float = 0.4,
          window: tuple[float, float] | None = None) -> Scores:
    if window is not None:
        lo, hi = window
        predictions = [p for p in predictions if lo - tolerance <= p.time <= hi + tolerance]
    m = match_events(labels, predictions, tolerance)
    tp = len(m)
    fp = len(predictions) - tp
    fn = len(labels) - tp
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else (0.0 if precision is not None and recall is not None else None)
    offsets = [predictions[pi].time - labels[li].time for li, pi in m]
    return Scores(tp, fp, fn, precision, recall, f1, float(np.median(offsets)) if offsets else None,
                  [(labels[li].time, predictions[pi].time) for li, pi in m])


def labels_from_export(data: dict, fighter_map: dict[str, str]) -> list[Event]:
    """Punch tags from a FightSmart export. fighter_map maps 'you'/'opponent' to track names ('A'/'B')."""
    return [Event(float(t["time"]), fighter_map[t["fighter"]]) for t in data.get("tags", [])
            if t.get("label") in PUNCHES and t.get("fighter") in fighter_map]
