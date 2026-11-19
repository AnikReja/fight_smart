"""Step 3: find *punch candidates*: moments where an arm extends quickly. A rule-based detector, not machine learning.

A punch, seen as joint positions, is the wrist moving away from the shoulder fast and then coming back.
For each fighter and each arm we compute two signals per frame:

  extension  = |wrist - shoulder| / torso length      (dimensionless, so camera distance doesn't matter)
  speed      = how fast the wrist moves relative to the fighter's own hips, in torso lengths per second
               (subtracting the hips ignores footwork; moving forward with the hands still isn't a punch)

A candidate is a local peak in extension that (a) is extended enough, (b) rose quickly in the preceding
window, and (c) had a fast wrist on the way out. Non-maximum suppression keeps one candidate per arm per
`min_separation` seconds.

This does NOT classify jab/cross/hook/uppercut. Thresholds below are starting guesses and must be tuned
against hand-labeled tags. The `score` is a heuristic ranking value, not a calibrated probability.
"""
from __future__ import annotations

import warnings
from dataclasses import asdict, dataclass

import numpy as np

from .pose import J


@dataclass
class DetectorConfig:
    min_conf: float = 0.3  # ignore joints the model is unsure about
    max_interp_gap: int = 3  # frames of missing data to fill by linear interpolation
    smooth: int = 3  # moving-average window (frames)
    min_extension: float = 0.75  # torso lengths from shoulder to wrist at the peak
    min_rise: float = 0.30  # extension gained within `rise_window`
    rise_window: float = 0.35  # seconds
    min_speed: float = 3.0  # torso lengths per second (peak, outward phase)
    min_separation: float = 0.25  # seconds between candidates on the same arm


@dataclass
class Candidate:
    time: float
    fighter: str
    arm: str  # "left" / "right" from the camera's perspective of the body (MediaPipe/COCO convention)
    score: float
    extension: float
    rise: float
    speed: float


def interpolate_gaps(x: np.ndarray, max_gap: int) -> np.ndarray:
    """Linearly fill NaN runs of length <= max_gap (1-D). Longer gaps stay NaN."""
    x = x.astype(float).copy()
    n = len(x)
    i = 0
    while i < n:
        if np.isnan(x[i]):
            j = i
            while j < n and np.isnan(x[j]):
                j += 1
            if 0 < i and j < n and j - i <= max_gap:
                x[i:j] = np.linspace(x[i - 1], x[j], j - i + 2)[1:-1]
            i = j
        else:
            i += 1
    return x


def moving_average(x: np.ndarray, window: int) -> np.ndarray:
    """Centered moving average that ignores NaNs; a frame stays NaN if its whole window is NaN."""
    if window <= 1:
        return x.copy()
    pad = window // 2
    padded = np.pad(x, pad, constant_values=np.nan)
    stacked = np.stack([padded[i:i + len(x)] for i in range(window)])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN windows are expected (joint not visible)
        out = np.nanmean(stacked, axis=0)
    out[np.isnan(x)] = np.nan  # don't invent values where the joint was missing
    return out


def rolling_median(x: np.ndarray, window: int) -> np.ndarray:
    """Centered rolling median ignoring NaNs; NaN where the whole window is NaN."""
    half = window // 2
    out = np.full(len(x), np.nan)
    for i in range(len(x)):
        chunk = x[max(0, i - half): i + half + 1]
        if not np.isnan(chunk).all():
            out[i] = np.nanmedian(chunk)
    return out


def find_peaks(x: np.ndarray) -> np.ndarray:
    """Indices i with x[i-1] < x[i] >= x[i+1] (ignores NaNs)."""
    left = x[1:-1] > x[:-2]
    right = x[1:-1] >= x[2:]
    return np.where(left & right)[0] + 1


def non_max_suppression(times: np.ndarray, scores: np.ndarray, min_separation: float) -> list[int]:
    """Greedy: keep the highest-scoring index, drop others within min_separation, repeat."""
    order = np.argsort(-scores)
    kept: list[int] = []
    for i in order:
        if all(abs(times[i] - times[k]) >= min_separation for k in kept):
            kept.append(int(i))
    return sorted(kept, key=lambda i: times[i])


def arm_signals(series: np.ndarray, times: np.ndarray, side: str, cfg: DetectorConfig) -> tuple[np.ndarray, np.ndarray]:
    """Extension and relative wrist speed for one arm. series: (F, 11, 3)."""
    s, w = J[f"{side}_shoulder"], J[f"{side}_wrist"]

    def joint(idx: int) -> np.ndarray:
        xy = series[:, idx, :2].astype(float).copy()
        xy[series[:, idx, 2] < cfg.min_conf] = np.nan
        return np.stack([interpolate_gaps(xy[:, k], cfg.max_interp_gap) for k in range(2)], axis=1)

    shoulder, wrist = joint(s), joint(w)
    hips = (joint(J["l_hip"]) + joint(J["r_hip"])) / 2
    shoulders = (joint(J["l_shoulder"]) + joint(J["r_shoulder"])) / 2
    torso = np.linalg.norm(shoulders - hips, axis=1)
    # Torso length changes slowly; a ~1-second rolling median rejects single-frame glitches.
    fps = 1 / float(np.median(np.diff(times))) if len(times) > 1 else 30.0
    torso = rolling_median(torso, max(3, int(round(fps))))

    extension = moving_average(np.linalg.norm(wrist - shoulder, axis=1) / torso, cfg.smooth)
    rel = moving_average(np.linalg.norm(np.gradient(wrist - hips, times, axis=0), axis=1), cfg.smooth) / torso
    return extension, rel


def detect(series: np.ndarray, times: np.ndarray, fighter: str, cfg: DetectorConfig = DetectorConfig()) -> list[Candidate]:
    out: list[Candidate] = []
    dt = float(np.median(np.diff(times))) if len(times) > 1 else 1 / 30
    k = max(1, int(round(cfg.rise_window / dt)))
    for side in ("left", "right"):
        ext, speed = arm_signals(series, times, "l" if side == "left" else "r", cfg)
        found: list[Candidate] = []
        for i in find_peaks(ext):
            lo = max(0, i - k)
            window_ext, window_speed = ext[lo:i + 1], speed[lo:i + 1]
            if np.isnan(window_ext).all() or np.isnan(ext[i]):
                continue
            rise = float(ext[i] - np.nanmin(window_ext))
            peak_speed = float(np.nanmax(window_speed)) if not np.isnan(window_speed).all() else 0.0
            if ext[i] < cfg.min_extension or rise < cfg.min_rise or peak_speed < cfg.min_speed:
                continue
            score = float(np.tanh(rise / cfg.min_rise - 1) * 0.5 + np.tanh(peak_speed / cfg.min_speed - 1) * 0.5) * 0.5 + 0.5
            found.append(Candidate(float(times[i]), fighter, side, round(score, 3), round(float(ext[i]), 3), round(rise, 3), round(peak_speed, 2)))
        if found:
            keep = non_max_suppression(np.array([c.time for c in found]), np.array([c.score for c in found]), cfg.min_separation)
            out.extend(found[i] for i in keep)
    return sorted(out, key=lambda c: c.time)


def config_dict(cfg: DetectorConfig) -> dict:
    return asdict(cfg)
