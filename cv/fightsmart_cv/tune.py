"""Tune punch-candidate thresholds on one time range and report the score on a different one.

  python -m fightsmart_cv.tune output/round3_rtmo_s.npz output/round3 --labels output/round3_labels.json --you A --split 105

Why split? If we pick thresholds by looking at the same punches we score on, the score measures how well we
memorized those punches, not how well the detector works. So:
  tune set  = labels before --split seconds  → grid search picks thresholds + a timing correction
  test set  = labels after  --split seconds  → scored ONCE with the chosen settings; never used for choosing

The timing correction: the detector marks the moment of peak arm extension, a human tags when they see the
punch start. The median gap between them (measured on the tune set only) is subtracted from predictions.
"""
from __future__ import annotations

import argparse
import itertools
import json
from dataclasses import asdict, replace
from pathlib import Path

import numpy as np

from .candidates import DetectorConfig, all_arm_signals, detect
from .evaluate import Event, labels_from_export, score
from .tracking import fighter_series

GRID = {
    "min_extension": [0.0, 0.3, 0.45, 0.6, 0.75],
    "min_rise": [0.0, 0.15, 0.3, 0.4],
    "min_speed": [2.0, 4.0, 6.0, 8.0, 10.0, 13.0],
    "rise_window": [0.25, 0.35, 0.5],
    "min_separation": [0.25, 0.5, 0.8],
}


def predictions(series: dict[str, np.ndarray], signals: dict, times: np.ndarray, cfg: DetectorConfig,
                shift: float = 0.0) -> list[Event]:
    out = []
    for name, s in series.items():
        out += [Event(c.time - shift, name) for c in detect(s, times, name, cfg, signals[name])]
    return out


def fmt(s) -> dict:
    return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in asdict(s).items() if k != "matches"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("poses", type=Path)
    parser.add_argument("analysis", type=Path, help="folder with assignment.npy from fightsmart_cv.analyze")
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--you", choices=["A", "B"], required=True)
    parser.add_argument("--split", type=float, required=True, help="seconds: tune before, test after")
    parser.add_argument("--tolerance", type=float, default=0.4)
    args = parser.parse_args()

    data = np.load(args.poses)
    times, landmarks = data["times"], data["landmarks"]
    assignment = np.load(args.analysis / "assignment.npy")
    other = "B" if args.you == "A" else "A"
    labels = labels_from_export(json.loads(args.labels.read_text(encoding="utf-8")), {"you": args.you, "opponent": other})
    tune_labels = [l for l in labels if l.time < args.split]
    test_labels = [l for l in labels if l.time >= args.split]
    tune_window = (min(l.time for l in tune_labels), args.split)
    test_window = (args.split, max(l.time for l in test_labels))

    # Only run the detector on the labeled stretch (plus margin) to keep the grid search fast.
    keep = (times >= tune_window[0] - 2) & (times <= test_window[1] + 2)
    t = times[keep]
    series = {n: fighter_series(landmarks, assignment, i)[keep] for i, n in enumerate("AB")}

    baseline = DetectorConfig()
    signals = {n: all_arm_signals(s, t, baseline) for n, s in series.items()}  # computed once, reused by every config
    results = []
    for values in itertools.product(*GRID.values()):
        cfg = replace(baseline, **dict(zip(GRID.keys(), values)))
        preds = predictions(series, signals, t, cfg)
        s = score(tune_labels, preds, args.tolerance, tune_window)
        # Re-score with the tune set's own median offset removed (still tune data only).
        shift = s.median_offset or 0.0
        s2 = score(tune_labels, predictions(series, signals, t, cfg, shift), args.tolerance, tune_window)
        results.append((s2.f1 or 0.0, cfg, shift, s2))
    results.sort(key=lambda r: -r[0])
    best_f1, best_cfg, best_shift, best_tune = results[0]

    test_base = score(test_labels, predictions(series, signals, t, baseline), args.tolerance, test_window)
    test_best = score(test_labels, predictions(series, signals, t, best_cfg, best_shift), args.tolerance, test_window)
    per_fighter = {
        n: fmt(score([l for l in test_labels if l.fighter == n],
                     [p for p in predictions(series, signals, t, best_cfg, best_shift) if p.fighter == n], args.tolerance, test_window))
        for n in "AB"
    }
    report = {
        "split_s": args.split, "tolerance_s": args.tolerance,
        "tune": {"window_s": [round(x, 2) for x in tune_window], "labels": len(tune_labels), "configs_tried": len(results)},
        "test": {"window_s": [round(x, 2) for x in test_window], "labels": len(test_labels)},
        "chosen": {k: getattr(best_cfg, k) for k in GRID} | {"time_shift_s": round(best_shift, 3)},
        "tune_score_chosen": fmt(best_tune),
        "test_score_baseline": fmt(test_base),
        "test_score_chosen": fmt(test_best),
        "test_per_fighter_chosen": per_fighter,
        "top5_on_tune": [{k: getattr(c, k) for k in GRID} | {"f1": round(f, 3)} for f, c, _, _ in results[:5]],
    }
    (args.analysis / "tuning.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
