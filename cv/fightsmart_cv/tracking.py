"""Step 2: turn per-frame detections (unordered people) into two consistent fighter identities, A and B.

A pose model has no memory: the same fighter can be person #0 in one frame and #1 in the next, and
bystanders appear too. We use a standard two-stage approach (tracklets + re-identification):

1. TRACKLETS - link detections frame-to-frame by position only, with a strict distance gate.
   Over a fraction of a second positions are reliable, so these short chains are almost always one person.
   A chain ends when the person disappears or the nearest match is too far (e.g. a clinch or crossing).

2. IDENTITY - average each tracklet's clothing-color histogram over all its frames (much cleaner than one
   frame), then assign whole tracklets to fighter A, fighter B, or "someone else" by comparing with A's and
   B's color profiles. Profiles start from the two biggest, longest-overlapping tracklets and are refined
   a few times (like k-means with two clusters plus an "other" bucket).

If two tracklets claim the same fighter at the same moment, the better color match wins that frame.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import warnings

import numpy as np

from .appearance import appearance_distance
from .pose import J


def hip_center(person: np.ndarray) -> np.ndarray:
    return (person[J["l_hip"], :2] + person[J["r_hip"], :2]) / 2


def body_height(person: np.ndarray) -> float:
    """Shoulder-to-knee vertical extent; more stable than full height because feet and head are often cut off."""
    top = np.nanmin(person[[J["l_shoulder"], J["r_shoulder"]], 1])
    bottom = np.nanmax(person[[J["l_knee"], J["r_knee"]], 1])
    return float(max(bottom - top, 1e-3))


@dataclass
class TrackConfig:
    link_gate: float = 0.5  # max hip movement between linked frames, in body heights
    max_frame_gap: int = 3  # frames a tracklet may skip and still continue
    ambiguity_margin: float = 0.15  # break a chain if a second person is within this many body heights of the best match
    min_tracklet_frames: int = 5  # shorter chains are too noisy to identify
    max_identity_distance: float = 0.35  # color distance above which a tracklet is "someone else"
    margin: float = 0.03  # must be this much closer to one fighter than the other
    min_relative_height: float = 0.65  # smaller than this fraction of the fighter's usual on-screen size = someone else (bystanders behind the ropes)
    iterations: int = 3


@dataclass
class Tracklet:
    frames: list[int] = field(default_factory=list)
    slots: list[int] = field(default_factory=list)
    appearance: np.ndarray | None = None
    height: float = 0.0

    @property
    def start(self) -> int:
        return self.frames[0]

    @property
    def end(self) -> int:
        return self.frames[-1]


def duplicate_mask(landmarks: np.ndarray, appearance: np.ndarray | None = None, threshold: float = 0.25,
                   same_look: float = 0.15) -> np.ndarray:
    """(F, P) True for detections that duplicate a more confident detection of the same person.

    Multi-person models occasionally output two nearly identical skeletons for one person. Two skeletons
    are treated as one if their joints are on average closer than `threshold` body heights AND (when
    appearance is given) their clothing colors match. Two *different* fighters can overlap on screen
    (one behind the other), but they don't wear the same colors, so they are kept apart.
    """
    frames, slots = landmarks.shape[:2]
    dup = np.zeros((frames, slots), dtype=bool)
    present = ~np.isnan(landmarks[:, :, J["l_hip"], 0])
    conf = np.nan_to_num(landmarks[:, :, :, 2]).mean(axis=2)  # empty slots score 0
    for f in range(frames):
        dets = sorted((s for s in range(slots) if present[f, s]), key=lambda s: -conf[f, s])
        kept: list[int] = []
        for s in dets:
            def duplicates(k: int) -> bool:
                close = (np.nanmean(np.linalg.norm(landmarks[f, s, :, :2] - landmarks[f, k, :, :2], axis=1))
                         / max(body_height(landmarks[f, k]), 1e-3) < threshold)
                if not close or appearance is None:
                    return close
                d = appearance_distance(appearance[f, s], appearance[f, k])
                return bool(np.isnan(d) or d < same_look)

            same = any(duplicates(k) for k in kept)
            if same:
                dup[f, s] = True
            else:
                kept.append(s)
    return dup


def build_tracklets(landmarks: np.ndarray, config: TrackConfig, appearance: np.ndarray | None = None) -> list[Tracklet]:
    frames, slots = landmarks.shape[:2]
    present = ~np.isnan(landmarks[:, :, J["l_hip"], 0]) & ~duplicate_mask(landmarks, appearance)
    finished: list[Tracklet] = []
    active: list[Tracklet] = []
    for f in range(frames):
        dets = [s for s in range(slots) if present[f, s]]
        alive = [t for t in active if f - t.end <= config.max_frame_gap]
        finished.extend(t for t in active if t not in alive)
        active = alive

        def link_cost(t: Tracklet, s: int) -> float:
            last = landmarks[t.end, t.slots[-1]]
            return float(np.linalg.norm(hip_center(landmarks[f, s]) - hip_center(last)) / max(body_height(last), 1e-3))

        # Greedy matching: closest (tracklet, detection) pairs first, each used once, within the gate.
        costs = {(ti, s): link_cost(t, s) for ti, t in enumerate(active) for s in dets}
        best: dict[int, int] = {}
        ambiguous: set[int] = set()
        for (ti, s), c in sorted(costs.items(), key=lambda kv: kv[1]):
            if c > config.link_gate or ti in best or ti in ambiguous or s in best.values():
                continue
            # If another person is almost as close, we can't tell who continued this chain (crossing,
            # clinch). End the chain here; appearance will identify the pieces on either side.
            rivals = [costs[ti, o] for o in dets if o != s and costs[ti, o] - c < config.ambiguity_margin]
            if rivals:
                ambiguous.add(ti)
                continue
            best[ti] = s
        if ambiguous:
            finished.extend(active[ti] for ti in ambiguous)
        used = set()
        for ti, s in best.items():
            active[ti].frames.append(f)
            active[ti].slots.append(s)
            used.add(s)
        active = [t for ti, t in enumerate(active) if ti not in ambiguous]
        for s in dets:
            if s not in used:
                active.append(Tracklet([f], [s]))
    finished.extend(active)
    return [t for t in finished if len(t.frames) >= config.min_tracklet_frames]


def summarize(tracklets: list[Tracklet], landmarks: np.ndarray, appearance: np.ndarray) -> None:
    for t in tracklets:
        feats = appearance[t.frames, t.slots]  # (n, regions, colors)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # regions never visible stay NaN
            t.appearance = np.nanmean(feats, axis=0)
        t.height = float(np.median([body_height(landmarks[f, s]) for f, s in zip(t.frames, t.slots)]))


def overlap(a: Tracklet, b: Tracklet) -> int:
    return max(0, min(a.end, b.end) - max(a.start, b.start))


def seed_profiles(tracklets: list[Tracklet], landmarks: np.ndarray, min_difference: float = 0.15) -> tuple[np.ndarray, np.ndarray]:
    """Two big, long tracklets that are on screen together and dressed differently; A is whoever is further left."""
    weight = lambda t: len(t.frames) * t.height
    ranked = sorted(tracklets, key=weight, reverse=True)
    first = ranked[0]
    distinct = [t for t in ranked[1:] if overlap(first, t) > 0
                and appearance_distance(first.appearance, t.appearance) >= min_difference]
    second = max(distinct, key=lambda t: weight(t) * overlap(first, t), default=None)
    if second is None:
        raise ValueError("Never saw two people at the same time; can't identify two fighters.")
    f = max(first.start, second.start)
    x = lambda t: hip_center(landmarks[f, t.slots[t.frames.index(f)]])[0] if f in t.frames else t.start
    a, b = sorted([first, second], key=x)
    return a.appearance, b.appearance


def seed_profiles_at(tracklets: list[Tracklet], landmarks: np.ndarray, times: np.ndarray,
                     seed_time: float) -> tuple[np.ndarray, np.ndarray]:
    """User-chosen seed: at `seed_time` the two biggest people on screen are the fighters (A = left).

    Use when automatic seeding picks the wrong people (e.g. a coach standing still at the ropes is on
    screen longer than either fighter). One known moment is enough; color profiles do the rest.
    """
    f = int(np.argmin(np.abs(times - seed_time)))
    for offset in range(0, 30):  # if nobody is linked exactly there, look a few frames later
        here = [t for t in tracklets if f + offset in t.frames]
        if len(here) >= 2:
            g = f + offset
            biggest = sorted(here, key=lambda t: -body_height(landmarks[g, t.slots[t.frames.index(g)]]))[:2]
            a, b = sorted(biggest, key=lambda t: hip_center(landmarks[g, t.slots[t.frames.index(g)]])[0])
            return a.appearance, b.appearance
    raise ValueError(f"Fewer than two people tracked near {seed_time:.1f}s; pick a moment where both fighters are clearly visible.")


def assign_identities(tracklets: list[Tracklet], profiles: tuple[np.ndarray, np.ndarray], config: TrackConfig,
                      heights: tuple[float, float] = (0.0, 0.0)) -> list[int]:
    """Label each tracklet 0 (A), 1 (B), or -1 (someone else) by clothing color, with a size sanity check."""
    labels = []
    for t in tracklets:
        d = [appearance_distance(t.appearance, p) for p in profiles]
        if np.isnan(d).any():
            labels.append(-1)
            continue
        i = int(np.argmin(d))
        ok = (d[i] <= config.max_identity_distance and d[i] + config.margin <= d[1 - i]
              and t.height >= config.min_relative_height * heights[i])
        labels.append(i if ok else -1)
    return labels


def _profile_height(members: list[Tracklet]) -> float:
    """Typical body height of a fighter, weighting long tracklets more."""
    if not members:
        return 0.0
    return float(np.average([t.height for t in members], weights=[len(t.frames) for t in members]))


def track_two(times: np.ndarray, landmarks: np.ndarray, appearance: np.ndarray,
              config: TrackConfig = TrackConfig(), seed_time: float | None = None) -> np.ndarray:
    """Returns assignment (F, 2): detection slot used for fighter A and B in each frame, or -1.

    `seed_time`: a moment where the two biggest people on screen are the fighters (optional; otherwise
    the fighters are guessed as the biggest, longest-visible pair of differently dressed people).
    """
    tracklets = build_tracklets(landmarks, config, appearance)
    summarize(tracklets, landmarks, appearance)
    tracklets = [t for t in tracklets if not np.isnan(t.appearance).all()]
    if not tracklets:
        return np.full((landmarks.shape[0], 2), -1, dtype=int)

    profiles = seed_profiles(tracklets, landmarks) if seed_time is None else seed_profiles_at(tracklets, landmarks, times, seed_time)
    heights = (0.0, 0.0)
    # With a user-chosen seed, keep its color profiles fixed: refining them by averaging every matched
    # tracklet lets look-alikes who are on screen longer (coaches at the ropes) pull the profile toward them.
    iterations = config.iterations if seed_time is None else 0
    if seed_time is not None:
        labels = assign_identities(tracklets, profiles, config, heights)
        heights = tuple(_profile_height([t for t, l in zip(tracklets, labels) if l == i]) for i in (0, 1))
    for _ in range(iterations):
        labels = assign_identities(tracklets, profiles, config, heights)
        heights = tuple(_profile_height([t for t, l in zip(tracklets, labels) if l == i]) for i in (0, 1))
        new = []
        for i in (0, 1):
            members = [t for t, l in zip(tracklets, labels) if l == i]
            if not members:
                new.append(profiles[i])
                continue
            w = np.array([len(t.frames) for t in members], dtype=float)
            stacked = np.stack([t.appearance for t in members])
            with np.errstate(all="ignore"):  # a region never seen in any member stays NaN
                new.append(np.nansum(stacked * w[:, None, None], axis=0) / np.nansum(~np.isnan(stacked) * w[:, None, None], axis=0))
        profiles = (new[0], new[1])
    labels = assign_identities(tracklets, profiles, config, heights)

    # Candidates per frame and fighter: (color distance, slot).
    frames = landmarks.shape[0]
    candidates: list[list[list[tuple[float, int]]]] = [[[], []] for _ in range(frames)]
    for t, label in zip(tracklets, labels):
        if label < 0:
            continue
        d = appearance_distance(t.appearance, profiles[label])
        for f, s in zip(t.frames, t.slots):
            candidates[f][label].append((d, s))

    # Best color match per fighter in each frame.
    # (Tried and removed: preferring the candidate closest to the other fighter. On screen, a spectator
    # standing *behind* a fighter looks close too, so it picked spectators more often than it fixed errors.)
    assignment = np.full((frames, 2), -1, dtype=int)
    for f in range(frames):
        for i in (0, 1):
            options = [(d, s) for d, s in sorted(candidates[f][i]) if s != assignment[f, 1 - i]]
            if options:
                assignment[f, i] = options[0][1]
    return assignment


def fighter_series(landmarks: np.ndarray, assignment: np.ndarray, fighter: int) -> np.ndarray:
    """(F, 11, 3) joints for one fighter, NaN where the fighter was not matched."""
    out = np.full((landmarks.shape[0],) + landmarks.shape[2:], np.nan, dtype=np.float32)
    rows = assignment[:, fighter] >= 0
    out[rows] = landmarks[rows, assignment[rows, fighter]]
    return out
