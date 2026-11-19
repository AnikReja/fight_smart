"""Tests on synthetic skeletons where the right answer is known."""
import numpy as np
import pytest

from fightsmart_cv.candidates import DetectorConfig, detect, interpolate_gaps, moving_average, non_max_suppression
from fightsmart_cv.evaluate import Event, labels_from_export, match_events, score
from fightsmart_cv.pose import J, JOINTS
from fightsmart_cv.tracking import fighter_series, track_two

FPS = 30


def standing_body(x: float = 0.5, conf: float = 0.9) -> np.ndarray:
    """A simple upright skeleton: torso length 0.2, hands at guard (close to shoulders)."""
    p = np.zeros((len(JOINTS), 3), dtype=np.float32)
    coords = {
        "nose": (0, 0.20), "l_shoulder": (-0.04, 0.25), "r_shoulder": (0.04, 0.25),
        "l_elbow": (-0.05, 0.32), "r_elbow": (0.05, 0.32), "l_wrist": (-0.03, 0.27), "r_wrist": (0.03, 0.27),
        "l_hip": (-0.03, 0.45), "r_hip": (0.03, 0.45), "l_knee": (-0.03, 0.58), "r_knee": (0.03, 0.58),
    }
    for name, (dx, y) in coords.items():
        p[J[name]] = (x + dx, y, conf)
    return p


def punch_sequence(duration: float, punches: list[tuple[float, str]], step_speed: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """Frames of one fighter throwing straight punches (extend 0.25 out and back over 0.3s) at given times."""
    times = np.arange(0, duration, 1 / FPS)
    series = np.stack([standing_body(0.3 + step_speed * t) for t in times])
    for t0, side in punches:
        w = J[f"{side[0]}_wrist"]
        for i, t in enumerate(times):
            phase = (t - t0) / 0.3
            if 0 <= phase <= 1:
                series[i, w, 0] += 0.25 * np.sin(np.pi * phase)  # out and back
    return series, times


def test_detects_punches_on_the_correct_arm_and_time():
    series, times = punch_sequence(4, [(0.5, "left"), (2.0, "right"), (3.0, "left")])
    found = detect(series, times, "A")
    assert [(c.arm, round(c.time, 1)) for c in found] == [("left", 0.6), ("right", 2.1), ("left", 3.1)]
    assert all(0 <= c.score <= 1 for c in found)


def test_ignores_footwork_and_small_hand_movements():
    series, times = punch_sequence(3, [], step_speed=0.3)  # walking forward fast, hands at guard
    assert detect(series, times, "A") == []
    series, times = punch_sequence(3, [])
    series[:, J["l_wrist"], 0] += 0.03 * np.sin(np.arange(len(times)) / 3)  # small guard movement
    assert detect(series, times, "A") == []


def test_low_confidence_wrists_are_ignored():
    series, times = punch_sequence(2, [(0.5, "left")])
    series[:, J["l_wrist"], 2] = 0.1
    assert detect(series, times, "A") == []


def test_signal_helpers():
    assert np.allclose(interpolate_gaps(np.array([0, np.nan, np.nan, 3.0]), 2), [0, 1, 2, 3])
    assert np.isnan(interpolate_gaps(np.array([0, np.nan, np.nan, np.nan, 4.0]), 2)[2])
    assert np.isnan(moving_average(np.array([1.0, np.nan, 3.0]), 3)[1])
    assert non_max_suppression(np.array([0.0, 0.1, 0.5]), np.array([0.5, 0.9, 0.7]), 0.25) == [1, 2]


def test_detector_config_thresholds_matter():
    series, times = punch_sequence(2, [(0.5, "left")])
    assert detect(series, times, "A", DetectorConfig(min_extension=5.0)) == []


# ---- evaluation -----------------------------------------------------------------

def test_matching_is_one_to_one_and_fighter_specific():
    labels = [Event(1.0, "A"), Event(1.3, "A"), Event(5.0, "B")]
    preds = [Event(1.1, "A"), Event(5.1, "A")]
    assert match_events(labels, preds, 0.4) == [(0, 0)]


def test_precision_recall_f1():
    labels = [Event(t, "A") for t in (1, 2, 3, 4)]
    preds = [Event(t + 0.1, "A") for t in (1, 2, 3)] + [Event(8, "A")]
    s = score(labels, preds, tolerance=0.3)
    assert (s.tp, s.fp, s.fn) == (3, 1, 1)
    assert s.precision == pytest.approx(0.75) and s.recall == pytest.approx(0.75) and s.f1 == pytest.approx(0.75)
    assert s.median_offset == pytest.approx(0.1)


def test_window_excludes_unlabeled_footage():
    labels = [Event(10, "A")]
    preds = [Event(10.1, "A"), Event(100, "A")]
    assert score(labels, preds, 0.3, window=(5, 20)).fp == 0


def test_labels_from_export_keeps_only_mapped_punches():
    data = {"tags": [
        {"time": 1, "label": "Jab", "fighter": "you"}, {"time": 2, "label": "Slip", "fighter": "you"},
        {"time": 3, "label": "Hook", "fighter": "opponent"}, {"time": 4, "label": "Cross"},
    ]}
    assert labels_from_export(data, {"you": "B", "opponent": "A"}) == [Event(1, "B"), Event(3, "A")]


# ---- tracking -------------------------------------------------------------------

def hist(**colors):
    from fightsmart_cv.appearance import COLOR_NAMES, N_COLORS
    h = np.zeros(N_COLORS)
    for name, v in colors.items():
        h[COLOR_NAMES.index(name)] = v
    return h / h.sum()


RED_VEST = np.stack([hist(red=0.4, dark=0.6), hist(light=0.9, dark=0.1)])  # torso, legs
DARK_KIT = np.stack([hist(dark=0.9, black=0.1), hist(dark=0.95, black=0.05)])
WHITE_TEE = np.stack([hist(white=0.9, light=0.1), hist(dark=0.9, black=0.1)])


def test_tracker_keeps_identities_through_order_flips_crossings_and_bystanders():
    frames = 90
    times = np.arange(frames) / FPS
    lm = np.full((frames, 3, len(JOINTS), 3), np.nan, dtype=np.float32)
    app = np.full((frames, 3, 2, 10), np.nan, dtype=np.float32)
    for f in range(frames):
        # A walks left->right and B right->left, crossing mid-clip (same position at f=45).
        a, b = standing_body(0.2 + f * 0.006), standing_body(0.74 - f * 0.006)
        order = [(a, RED_VEST), (b, DARK_KIT)]
        if f % 2:
            order.reverse()  # the model returns people in arbitrary order
        for s, (body, look) in enumerate(order):
            lm[f, s], app[f, s] = body, look
        if f > 30:  # a small bystander far away, dressed differently
            small = standing_body(0.9)
            small[:, 1] = 0.1 + small[:, 1] * 0.3
            lm[f, 2], app[f, 2] = small, WHITE_TEE
    assignment = track_two(times, lm, app)
    a_x = fighter_series(lm, assignment, 0)[:, J["l_hip"], 0]
    b_x = fighter_series(lm, assignment, 1)[:, J["l_hip"], 0]
    true_a = 0.2 + np.arange(frames) * 0.006 - 0.03
    tracked = ~np.isnan(a_x) & ~np.isnan(b_x)
    assert tracked.mean() > 0.8
    assert np.allclose(a_x[tracked], true_a[tracked], atol=1e-4)  # A is always the red vest, even after crossing
    assert not np.any(assignment == 2)  # the bystander is never chosen


def test_duplicate_skeletons_are_dropped():
    from fightsmart_cv.tracking import duplicate_mask
    lm = np.full((1, 3, len(JOINTS), 3), np.nan, dtype=np.float32)
    lm[0, 0] = standing_body(0.3, conf=0.9)
    lm[0, 1] = standing_body(0.305, conf=0.6)  # same person, less confident
    lm[0, 2] = standing_body(0.7)
    assert duplicate_mask(lm).tolist() == [[False, True, False]]


def test_color_names_and_distance():
    from fightsmart_cv.appearance import COLOR_NAMES, appearance_distance, color_names
    pixels = np.array([[0, 0, 20], [0, 0, 240], [0, 200, 200], [178, 200, 200], [115, 200, 200]])
    assert [COLOR_NAMES[i] for i in color_names(pixels)] == ["black", "white", "red", "red", "blue"]
    assert appearance_distance(RED_VEST, RED_VEST) == pytest.approx(0, abs=1e-6)
    assert appearance_distance(RED_VEST, DARK_KIT) > appearance_distance(DARK_KIT, DARK_KIT) + 0.3
    half_hidden = RED_VEST.copy()
    half_hidden[1] = np.nan  # legs not visible: compare torso only
    assert appearance_distance(half_hidden, RED_VEST) == pytest.approx(0, abs=1e-6)
