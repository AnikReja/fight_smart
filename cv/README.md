# FightSmart CV experiments

Offline Python pipeline that tests whether pose estimation on real sparring footage is good enough to
suggest punches. Everything runs locally on CPU with free, permissively licensed models. **Nothing here
classifies punch types yet**, and no accuracy is claimed until it's measured against hand-labeled tags.

## Pipeline

```
video ──► pose.py ──► poses.npz ──► appearance.py ──► analyze.py ──► summary.json / candidates.json ──► overlay.py
          (model, slow)             (clothing colors)  (tracking + punch candidates + optional evaluation)
```

| Step | File | What it does |
|---|---|---|
| 1 | `pose.py` | Runs a pretrained pose model on every frame (inference only, no training). Maps output to 11 joints. |
| 2a | `appearance.py` | Color-name histograms (black … white, red … purple) of each person's torso and legs. |
| 2b | `tracking.py` | Removes duplicate skeletons, links detections into short position-based *tracklets*, then labels whole tracklets as fighter A, B, or someone else by clothing color and on-screen size. |
| 3 | `candidates.py` | Rule-based punch-candidate detector: fast arm extension relative to the fighter's own torso length and hips. |
| 4 | `evaluate.py` | Event-level precision / recall against FightSmart tags (±0.4s, one-to-one matching). |
| – | `overlay.py` | Review video: tracks A (green) / B (blue), other people gray, candidates circled in gold. |

## Setup (Windows, Python 3.12)

```bash
py -3.12 -m venv cv/.venv
cv/.venv/Scripts/python -m pip install mediapipe==0.10.21 onnxruntime==1.20.1 tqdm pytest
cv/.venv/Scripts/python -m pip install rtmlib==0.0.13 --no-deps
cd cv && .venv/Scripts/python -m pytest -q tests
```

MediaPipe's model goes in `cv/models/` ([pose_landmarker_full.task](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task), 9 MB).
RTMO downloads itself on first run (~36 MB) into `~/.cache/rtmlib`.
`cv/models/`, `cv/output/`, and the venv are git-ignored: **never commit footage or anything derived from it.**

## Usage

```bash
cd cv
.venv/Scripts/python -m fightsmart_cv.pose VIDEO.mp4 --backend rtmo --out output/round3.npz
.venv/Scripts/python -m fightsmart_cv.appearance VIDEO.mp4 output/round3.npz
.venv/Scripts/python -m fightsmart_cv.analyze output/round3.npz --out output/round3
.venv/Scripts/python -m fightsmart_cv.overlay VIDEO.mp4 output/round3.npz output/round3 --out output/round3/overlay.mp4
# or everything for every clip in a folder:
.venv/Scripts/python -m fightsmart_cv.batch output/pro
# after tagging punches in the app and exporting JSON (A/B: which track is you, from the overlay)
.venv/Scripts/python -m fightsmart_cv.analyze output/round3.npz --out output/round3 --labels round3-fightsmart.json --you A
```

## Measured results

**Hardware:** Intel i7-13700H (14 cores), 16 GB RAM, Intel Iris Xe (no CUDA GPU). CPU inference only.
**Footage:** one sparring round from a fixed gym security camera, 848×438 @ 30 fps, 4.5 min. Wide, elevated
angle; fighters ~200 px tall; ring ropes occlude limbs; up to 2 bystanders in frame.

### Experiment 1: which pose model works on this footage? (same 10 s sample, 301 frames)

| Model | License | Speed (CPU) | Both fighters tracked | Arms usable (A / B)\* |
|---|---|---|---|---|
| MediaPipe Pose Landmarker (full), 4 poses | Apache-2.0 | 5.8 fps | 17% | 26–28% / 17–19% |
| **RTMO-s** (rtmlib, ONNX) | Apache-2.0 | 4.2 fps | **89%** | **79–90% / 94–97%** |

\* frames where shoulder, wrist, and both hips are detected with confidence ≥ 0.3.

**Why the difference:** MediaPipe first finds a person, then fits a skeleton. That person detector is tuned
for one person close to the camera (fitness / selfie video), so small, overlapping fighters are often
missed entirely. RTMO is a *one-stage multi-person* model trained on crowded scenes (COCO, CrowdPose and
others), predicting every person's keypoints in one pass, which suits a wide two-fighter shot.

**Decision:** use RTMO-s. RTMO-m (larger) is untested; its download from the OpenMMLab server was too slow
to include, and RTMO-s already passes the "can we see both fighters' arms" gate.

### Experiment 2: keeping the two fighters apart (full round, 8,049 frames)

A pose model has no memory, so a tracker must decide which skeleton is which fighter in every frame.
Identity was spot-checked **by eye on 12 moments, every 20 s** (24 fighter labels). A small sample:
it shows the kinds of errors, not a precise error rate.

| Tracker version | Correct | Wrong person | Missing |
|---|---|---|---|
| v1: nearest hip position + mean clothing color | visible swaps: A was the red-vest fighter at 75 s and the other fighter at 150 s; started on bystanders before the round | | |
| v2: position *tracklets* + color-name histograms | 19 / 24 | 3 | 2 |
| v3: + skip duplicate skeletons (2,256 removed) | 20 / 24 | 2 | 2 |
| **v4: + break tracklets at crossings, keep duplicates that look different, color ≤ 0.35 *and* size ≥ 65%** | **20 / 24** | **0** | **4** |

What each fix addressed:
- **Duplicates:** RTMO sometimes outputs two skeletons for one person; the tracker then "found" both fighters
  in the same body. A duplicate must now be in the same place *and* wear the same colors, so two real fighters
  overlapping on screen are not merged.
- **Crossings and clinches:** a position-only chain can jump from one fighter to the other. Chains now end when
  a second person is almost as close, and the pieces are identified by color separately.
- **Bystanders:** a person standing behind the far ropes in a white shirt was a 0.33 color match for fighter A
  (A's own tracklets: 0.07–0.14) and half A's on-screen size. Requiring both a close color match and a
  plausible size removed them. Color alone at 0.25 also removed them, but dropped fighter B from 82% to 59% of
  frames because the red vest only shows from the front.

Coverage with v4: fighter A in 94% of frames, B in 75%, both in 70%. Arms usable: A 90%, B 67–73%. B is lost
mostly in clinches and when facing away from the camera. Missing is preferred over wrong: a wrong label
would silently put one fighter's punches in the other's stats.

### Experiment 3: punch-candidate detection

216 candidates over the 4.5-minute round (A 27.7/min, B 20.5/min). **These are unvalidated.** Until a
labeled segment is evaluated, the counts say nothing about accuracy. One suspicious pattern: 29 candidates
come in same-fighter "both arms within 0.1 s" pairs, which on review looked like guard adjustments.

Next: hand-tag punches for ~60 s of this round in the app, export, and run `analyze --labels` for
precision / recall.

### Speed on this laptop (CPU only)

| Step | Time for the 4.5-minute round |
|---|---|
| RTMO-s pose | 4.4–5.0 frames/s → about 28 min |
| Clothing colors | 54 s |
| Tracking + candidates | ~20 s |

## Glossary (interview notes)

- **Inference vs training:** we only run pretrained weights (inference). Training would mean updating
  weights from labeled examples. The candidate detector has no learned weights, just thresholds we tune.
- **Precision:** of the moments the detector flagged, the fraction that were real punches. False positives lower it.
- **Recall:** of the real punches, the fraction the detector found. False negatives (misses) lower it.
- **Why event matching with a tolerance:** a human tag lands ~0.2–0.4 s after the punch (reaction time), so
  exact-frame comparison would call everything wrong. Each label can match at most one prediction.
- **Why normalize by torso length:** a fighter far from the camera looks smaller; dividing by their own
  torso makes "arm fully extended" mean the same thing anywhere in the frame.
- **Data leakage (for later ML):** when training a classifier, evaluate on rounds/sessions it never saw,
  not on random frames of the same clip. Neighboring frames are nearly identical, which inflates scores.
