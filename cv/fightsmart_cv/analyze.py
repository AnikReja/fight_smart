"""Run tracking + punch-candidate detection on saved poses, write a report, and optionally evaluate.

  python -m fightsmart_cv.analyze output/round3.npz --out output/round3
  python -m fightsmart_cv.analyze output/round3.npz --out output/round3 --labels my-tags.json --you A

Outputs in --out:
  summary.json        detection coverage, candidate counts, (optional) precision/recall
  candidates.json     FightSmart-readable AI suggestions (kept separate from your manual tags)
  candidates.csv      same, for a spreadsheet
"""
from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict
from pathlib import Path

import numpy as np

from .appearance import appearance_path
from .candidates import DetectorConfig, config_dict, detect
from .evaluate import Event, labels_from_export, score
from .pose import J
from .tracking import fighter_series, track_two

NAMES = ("A", "B")


def coverage(series: np.ndarray, min_conf: float) -> dict:
    """How often the joints a punch detector needs were actually usable."""
    def frac(idx: list[int]) -> float:
        ok = np.all(series[:, idx, 2] >= min_conf, axis=1) & ~np.isnan(series[:, idx, 0]).any(axis=1)
        return round(float(ok.mean()), 3)

    return {
        "tracked": round(float((~np.isnan(series[:, J["l_hip"], 0])).mean()), 3),
        "left_arm_usable": frac([J["l_shoulder"], J["l_wrist"], J["l_hip"], J["r_hip"]]),
        "right_arm_usable": frac([J["r_shoulder"], J["r_wrist"], J["l_hip"], J["r_hip"]]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("poses", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--labels", type=Path, help="FightSmart export JSON with hand-tagged punches")
    parser.add_argument("--you", choices=NAMES, help="which track is you (see the overlay video)")
    parser.add_argument("--tolerance", type=float, default=0.4)
    args = parser.parse_args()

    data = np.load(args.poses)
    times, landmarks = data["times"], data["landmarks"]
    app_file = appearance_path(args.poses)
    if not app_file.exists():
        raise SystemExit(f"Missing {app_file.name}. Run: python -m fightsmart_cv.appearance VIDEO {args.poses}")
    appearance = np.load(app_file)
    meta = json.loads(str(data["meta"]))
    cfg = DetectorConfig()

    assignment = track_two(times, landmarks, appearance)
    people = (~np.isnan(landmarks[:, :, J["l_hip"], 0])).sum(axis=1)
    summary: dict = {
        "video": meta["video"], "backend": meta["backend"], "frames": len(times),
        "seconds": [round(float(times[0]), 2), round(float(times[-1]), 2)],
        "pose_speed_fps": meta["frames_per_second"],
        "people_per_frame": {int(k): int(v) for k, v in zip(*np.unique(people, return_counts=True))},
        "both_fighters_tracked": round(float((assignment >= 0).all(axis=1).mean()), 3),
        "detector": config_dict(cfg),
        "fighters": {},
    }

    candidates = []
    for i, name in enumerate(NAMES):
        series = fighter_series(landmarks, assignment, i)
        found = detect(series, times, name, cfg)
        candidates.extend(found)
        summary["fighters"][name] = {**coverage(series, cfg.min_conf), "candidates": len(found),
                                     "per_minute": round(len(found) / max((times[-1] - times[0]) / 60, 1e-9), 1)}
    candidates.sort(key=lambda c: c.time)

    if args.labels:
        if not args.you:
            raise SystemExit("--you A|B is required with --labels (which track is you?)")
        other = "B" if args.you == "A" else "A"
        export = json.loads(args.labels.read_text(encoding="utf-8"))
        labels = labels_from_export(export, {"you": args.you, "opponent": other})
        if not labels:
            raise SystemExit("No punch tags with a fighter found in the labels file.")
        window = (min(l.time for l in labels), max(l.time for l in labels))
        preds = [Event(c.time, c.fighter) for c in candidates]
        overall = score(labels, preds, args.tolerance, window)
        per = {n: score([l for l in labels if l.fighter == n], [p for p in preds if p.fighter == n], args.tolerance, window)
               for n in NAMES}
        fmt = lambda s: {k: (round(v, 3) if isinstance(v, float) else v) for k, v in asdict(s).items() if k != "matches"}
        summary["evaluation"] = {"labels_file": args.labels.name, "tolerance_s": args.tolerance,
                                 "window_s": [round(w, 2) for w in window], "labels": len(labels),
                                 "overall": fmt(overall), "per_fighter": {n: fmt(s) for n, s in per.items()}}

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (args.out / "candidates.json").write_text(json.dumps({
        "app": "fightsmart-ai", "schemaVersion": 1, "kind": "punch-candidates",
        "video": meta["video"], "model": meta["backend"], "detector": config_dict(cfg),
        "note": "Heuristic candidates from pose data. Score is a ranking value, not a probability.",
        "predictions": [asdict(c) for c in candidates],
    }, indent=2), encoding="utf-8")
    with open(args.out / "candidates.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(asdict(candidates[0]).keys()) if candidates else ["time"])
        writer.writeheader()
        for c in candidates:
            writer.writerow(asdict(c))
    np.save(args.out / "assignment.npy", assignment)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
