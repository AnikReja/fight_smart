"""Render a review video: tracked fighters (A green, B blue), other detections gray, punch candidates flagged.

  python -m fightsmart_cv.overlay VIDEO output/round3.npz output/round3 --out output/round3/overlay.mp4

Use it to (1) check whether pose/tracking is good enough on your footage, and (2) see which track is you.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from .pose import J

BONES = [("l_shoulder", "r_shoulder"), ("l_shoulder", "l_elbow"), ("l_elbow", "l_wrist"), ("r_shoulder", "r_elbow"),
         ("r_elbow", "r_wrist"), ("l_shoulder", "l_hip"), ("r_shoulder", "r_hip"), ("l_hip", "r_hip"),
         ("l_hip", "l_knee"), ("r_hip", "r_knee")]
COLORS = {0: (122, 167, 63), 1: (224, 155, 124)}  # BGR: green (A), blue (B), matching the app
GRAY = (140, 140, 140)
GOLD = (143, 197, 224)


def draw_person(img, person, color, min_conf=0.3):
    h, w = img.shape[:2]
    pt = lambda n: (int(person[J[n], 0] * w), int(person[J[n], 1] * h))
    ok = lambda n: not np.isnan(person[J[n], 0]) and person[J[n], 2] >= min_conf
    for a, b in BONES:
        if ok(a) and ok(b):
            cv2.line(img, pt(a), pt(b), color, 2, cv2.LINE_AA)
    for n in ("l_wrist", "r_wrist"):
        if ok(n):
            cv2.circle(img, pt(n), 4, color, -1, cv2.LINE_AA)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("poses", type=Path)
    parser.add_argument("analysis", type=Path, help="folder written by fightsmart_cv.analyze")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--flash", type=float, default=0.3, help="seconds a candidate stays highlighted")
    args = parser.parse_args()

    data = np.load(args.poses)
    times, landmarks = data["times"], data["landmarks"]
    assignment = np.load(args.analysis / "assignment.npy")
    preds = json.loads((args.analysis / "candidates.json").read_text(encoding="utf-8"))["predictions"]

    cap = cv2.VideoCapture(str(args.video))
    stride = int(json.loads(str(data["meta"])).get("stride", 1))
    fps = (cap.get(cv2.CAP_PROP_FPS) or 30) / stride
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.set(cv2.CAP_PROP_POS_MSEC, float(times[0]) * 1000)
    writer = cv2.VideoWriter(str(args.out), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    for f, t in enumerate(times):
        ok, img = cap.read()
        if not ok:
            break
        for _ in range(stride - 1):
            cap.grab()
        tracked = set(assignment[f][assignment[f] >= 0])
        for s in range(landmarks.shape[1]):
            if not np.isnan(landmarks[f, s, J["l_hip"], 0]) and s not in tracked:
                draw_person(img, landmarks[f, s], GRAY)
        for i in (0, 1):
            s = assignment[f, i]
            if s < 0:
                continue
            person = landmarks[f, s]
            draw_person(img, person, COLORS[i])
            if not np.isnan(person[J["nose"], 0]):
                cv2.putText(img, "AB"[i], (int(person[J["nose"], 0] * w) - 6, int(person[J["nose"], 1] * h) - 18),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, COLORS[i], 2, cv2.LINE_AA)
            for p in preds:
                if p["fighter"] == "AB"[i] and 0 <= t - p["time"] <= args.flash:
                    wrist = person[J["l_wrist" if p["arm"] == "left" else "r_wrist"]]
                    if not np.isnan(wrist[0]):
                        c = (int(wrist[0] * w), int(wrist[1] * h))
                        cv2.circle(img, c, 14, GOLD, 2, cv2.LINE_AA)
                        cv2.putText(img, f"punch? {p['score']:.2f}", (c[0] + 10, c[1] - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, GOLD, 1, cv2.LINE_AA)
        cv2.putText(img, f"{t:6.2f}s", (w - 110, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
        writer.write(img)
    writer.release()
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
