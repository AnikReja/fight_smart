"""Appearance features for every detected person: what colors are on their torso and legs?

Position alone can't keep fighters apart: they circle, cross, and clinch. Clothing usually can
(e.g. red vest + gray shorts vs. dark shirt + dark pants).

For each detection we build a small "color name" histogram for two boxes derived from the skeleton:
  torso  shoulders → hips
  legs   hips → knees
Each pixel is named one of 10 colors: 4 neutrals by brightness (black, dark gray, light gray, white) when
saturation is low, otherwise 6 hues (red, orange/skin, yellow, green, blue, purple). The histogram says
e.g. "35% red, 50% black" for a red vest over a dark shirt. Averaging colors would say "muddy brown".

Two histograms are compared with the Hellinger distance: 0 = identical distributions, 1 = no overlap.
This re-reads the video with the saved skeletons, so it is fast (no neural network).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from .pose import J

REGIONS = ("torso", "legs")
COLOR_NAMES = ("black", "dark", "light", "white", "red", "orange", "yellow", "green", "blue", "purple")
N_COLORS = len(COLOR_NAMES)

# OpenCV hue is 0-179. Bin edges for saturated pixels.
_HUE_EDGES = np.array([0, 8, 22, 35, 85, 130, 165, 180])
_HUE_NAMES = np.array([4, 5, 6, 7, 8, 9, 4])  # red wraps around at both ends


def color_names(hsv_pixels: np.ndarray) -> np.ndarray:
    """Map (N, 3) HSV pixels to color-name indices 0-9."""
    h, s, v = hsv_pixels[:, 0].astype(int), hsv_pixels[:, 1].astype(int), hsv_pixels[:, 2].astype(int)
    neutral = (s < 70) | (v < 50)
    out = np.empty(len(h), dtype=int)
    out[neutral] = np.digitize(v[neutral], [60, 120, 190])  # black, dark, light, white
    hue_bin = np.clip(np.digitize(h[~neutral], _HUE_EDGES) - 1, 0, len(_HUE_NAMES) - 1)
    out[~neutral] = _HUE_NAMES[hue_bin]
    return out


def histogram(hsv: np.ndarray, x0: float, y0: float, x1: float, y1: float, min_pixels: int = 30) -> np.ndarray:
    hh, ww = hsv.shape[:2]
    xa, xb = sorted((int(np.clip(x0, 0, ww - 1)), int(np.clip(x1, 0, ww - 1))))
    ya, yb = sorted((int(np.clip(y0, 0, hh - 1)), int(np.clip(y1, 0, hh - 1))))
    pixels = hsv[ya:yb, xa:xb].reshape(-1, 3)
    if len(pixels) < min_pixels:
        return np.full(N_COLORS, np.nan)
    counts = np.bincount(color_names(pixels), minlength=N_COLORS).astype(float)
    return counts / counts.sum()


def person_appearance(hsv: np.ndarray, person: np.ndarray, min_conf: float = 0.3) -> np.ndarray:
    """(2 regions, 10 colors) for one skeleton; NaN rows where a region isn't visible."""
    h, w = hsv.shape[:2]
    out = np.full((len(REGIONS), N_COLORS), np.nan)
    xy = person[:, :2] * [w, h]
    ok = (person[:, 2] >= min_conf) & ~np.isnan(person[:, 0])

    def pts(*names):
        idx = [J[n] for n in names]
        return xy[idx] if ok[idx].all() else None

    shoulders, hips, knees = pts("l_shoulder", "r_shoulder"), pts("l_hip", "r_hip"), pts("l_knee", "r_knee")
    if shoulders is not None and hips is not None:
        box = np.vstack([shoulders, hips])
        cx, torso_len = box[:, 0].mean(), np.linalg.norm(shoulders.mean(0) - hips.mean(0))
        half = max(abs(box[:, 0] - cx).max() * 0.7, torso_len * 0.15)  # stay on the shirt
        out[0] = histogram(hsv, cx - half, box[:, 1].min(), cx + half, box[:, 1].max())
    if hips is not None and knees is not None:
        box = np.vstack([hips, knees])
        cx = box[:, 0].mean()
        half = max(abs(box[:, 0] - cx).max() * 0.8, 3)
        out[1] = histogram(hsv, cx - half, box[:, 1].min(), cx + half, box[:, 1].max())
    return out


def appearance_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Mean Hellinger distance over regions visible in both (NaN if none). 0 = same colors, 1 = disjoint."""
    dists = [float(np.sqrt(max(0.0, 1 - np.sum(np.sqrt(ra * rb)))))
             for ra, rb in zip(a, b) if not (np.isnan(ra).any() or np.isnan(rb).any())]
    return float(np.mean(dists)) if dists else np.nan


def compute(video: Path, poses: Path) -> np.ndarray:
    data = np.load(poses)
    times, landmarks = data["times"], data["landmarks"]
    stride = int(json.loads(str(data["meta"])).get("stride", 1))
    cap = cv2.VideoCapture(str(video))
    cap.set(cv2.CAP_PROP_POS_MSEC, float(times[0]) * 1000)
    feats = np.full(landmarks.shape[:2] + (len(REGIONS), N_COLORS), np.nan, dtype=np.float32)
    for f in range(len(times)):
        ok, frame = cap.read()
        if not ok:
            break
        for _ in range(stride - 1):
            cap.grab()
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        for s in range(landmarks.shape[1]):
            if not np.isnan(landmarks[f, s, J["l_hip"], 0]):
                feats[f, s] = person_appearance(hsv, landmarks[f, s])
    return feats


def appearance_path(poses: Path) -> Path:
    return poses.with_name(poses.stem + "_appearance.npy")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", type=Path)
    parser.add_argument("poses", type=Path)
    args = parser.parse_args()
    feats = compute(args.video, args.poses)
    np.save(appearance_path(args.poses), feats)
    print(f"wrote {appearance_path(args.poses)} {feats.shape}")


if __name__ == "__main__":
    main()
