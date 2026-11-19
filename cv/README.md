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
| 5 | `tune.py` | Grid-searches detector thresholds on one time range, reports the score on a held-out range. |
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
# tune thresholds on labels before 105 s, score once on labels after
.venv/Scripts/python -m fightsmart_cv.tune output/round3.npz output/round3 --labels round3-fightsmart.json --you A --split 105
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

### Experiment 3: punch-candidate detection, scored against hand tags

**Labels:** 35 punches hand-tagged in the app between 1:13 and 2:18 (10 by fighter A, 25 by B), at 0.5× speed.
A prediction counts as correct if it's within ±0.4 s of a tag by the same fighter (one-to-one).

| Setting | Data scored | Precision | Recall | F1 |
|---|---|---|---|---|
| Hand-picked defaults | all 35 labels | 18% | 29% | 0.22 |
| Defaults | test half (105–138 s, 17 labels) | 7% | 12% | 0.09 |
| Best of 720 threshold combos, chosen on the tune half (73–105 s) | tune half (where it was chosen) | 32% | 50% | 0.39 |
| Same chosen thresholds | **test half (never used for choosing)** | **8%** | **12%** | **0.09** |

The tuned thresholds fit the tune half and did not carry over: a textbook **overfitting** result, and the reason
for keeping a held-out test set. The five best combos on the tune half also disagreed wildly with each other.

**Why it fails:** how well each signal separates tagged-punch moments (±0.4 s) from 300 random other moments,
as ROC AUC (0.5 = coin flip, 1.0 = perfect):

| Signal | Fighter A (10 punches) | Fighter B (24 punches) |
|---|---|---|
| Max arm extension | 0.64 | 0.50 |
| Extension rise | 0.47 | 0.60 |
| Max wrist speed | 0.45 | 0.56 |

At ~200 px per fighter, a wrist is a few pixels, and from a high side angle straight punches toward or away from
the camera are foreshortened. Guard adjustments, parries, and feints produce the same skeleton motion.
Coarser ideas also failed on this minute: arm activity per 2 s window vs. tagged punches had Spearman −0.16, and
fighter distance −0.22 (they were in range in 97% of windows).

**Conclusion:** with this camera setup, pose-based punch detection is not reliable enough to suggest punches.
Tracking *who is where* works (Experiment 2); *what their hands did* does not.

Caveats: small label set (35, only 10 for A); a single annotator; untagged real punches may count as false
positives; one camera and one round.

What could change the answer (untested):
1. **Better footage:** a phone on a tripod at chest height, closer, 1080p at 60 fps, so wrists are larger and less blurred.
2. **Bigger or top-down pose model:** RTMO-m, or crop each tracked fighter, upscale, and run a single-person
   model (RTMPose) for sharper wrists.
3. **A learned classifier on pose sequences:** only worth trying once signals separate better than AUC ≈ 0.6
   and there are hundreds of labels.

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
- **Overfitting:** choosing settings that fit the examples you looked at rather than the pattern. Detected by
  scoring on held-out data: here F1 went from 0.39 (tune half) to 0.09 (test half).
- **ROC AUC:** the probability that a random real punch scores higher than a random non-punch moment. 0.5 means
  the signal carries no information; it checks a feature before building a detector on it.
- **Data leakage (for later ML):** when training a classifier, evaluate on rounds/sessions it never saw,
  not on random frames of the same clip. Neighboring frames are nearly identical, which inflates scores.
