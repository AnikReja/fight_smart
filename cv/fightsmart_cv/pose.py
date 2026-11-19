"""Step 1: run a pretrained pose model on every frame and save raw detections.

This is inference only: we use pretrained models as-is (no training). Two backends:

  mediapipe  Google MediaPipe Pose Landmarker (Apache-2.0). Strong for one person near the camera.
  rtmo       RTMO from OpenMMLab via rtmlib (Apache-2.0), a one-stage multi-person model (COCO-17 keypoints).

Both are mapped to the same 11 joints (see JOINTS) so later steps don't care which model ran.

Output (.npz):
  times        (F,)          seconds
  landmarks    (F, P, 11, 3) x, y (0-1 image coordinates), confidence; NaN where a person slot is empty
  meta         JSON string   video info, backend, processing speed
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

MODELS_DIR = Path(__file__).resolve().parents[1] / "models"

JOINTS = ["nose", "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist", "l_hip", "r_hip", "l_knee", "r_knee"]
J = {name: i for i, name in enumerate(JOINTS)}

# Where each canonical joint lives in each model's own output.
MEDIAPIPE_INDEX = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26]
COCO17_INDEX = [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

RTMO_URLS = {
    "s": "https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-s_8xb32-600e_body7-640x640-dac2bf74_20231211.zip",
    "m": "https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-m_16xb16-600e_body7-640x640-39e78cc4_20231211.zip",
}


class MediaPipeBackend:
    def __init__(self, num_poses: int):
        import mediapipe as mp

        self.mp = mp
        options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=str(MODELS_DIR / "pose_landmarker_full.task")),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_poses=num_poses,
            min_pose_detection_confidence=0.4,
            min_pose_presence_confidence=0.4,
            min_tracking_confidence=0.4,
        )
        self.landmarker = mp.tasks.vision.PoseLandmarker.create_from_options(options)
        self.name = "mediapipe pose_landmarker_full"

    def __call__(self, frame_bgr: np.ndarray, t_ms: int) -> list[np.ndarray]:
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        result = self.landmarker.detect_for_video(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb), t_ms)
        people = []
        for pose in result.pose_landmarks:
            full = np.array([(p.x, p.y, p.visibility) for p in pose], dtype=np.float32)
            people.append(full[MEDIAPIPE_INDEX])
        return people


class RTMOBackend:
    def __init__(self, size: str, score_thr: float):
        from rtmlib import RTMO

        self.model = RTMO(onnx_model=RTMO_URLS[size], model_input_size=(640, 640), backend="onnxruntime", device="cpu")
        self.score_thr = score_thr
        self.name = f"rtmo-{size} (body7, 640x640)"

    def __call__(self, frame_bgr: np.ndarray, t_ms: int) -> list[np.ndarray]:
        h, w = frame_bgr.shape[:2]
        keypoints, scores = self.model(frame_bgr, score_thr=self.score_thr)
        people = []
        for kp, sc in zip(keypoints, scores):
            person = np.zeros((len(JOINTS), 3), dtype=np.float32)
            person[:, 0] = kp[COCO17_INDEX, 0] / w
            person[:, 1] = kp[COCO17_INDEX, 1] / h
            person[:, 2] = sc[COCO17_INDEX]
            people.append(person)
        # Largest people first, so bystanders far from the camera are the ones dropped if slots run out.
        people.sort(key=lambda p: -(p[:, 1].max() - p[:, 1].min()))
        return people


def extract(video: Path, out: Path, backend, num_poses: int = 4, start: float = 0.0, end: float | None = None) -> dict:
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"Cannot open {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)

    times, landmarks = [], []
    t0 = time.perf_counter()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if end is not None and t > end:
            break
        people = backend(frame, int(t * 1000))[:num_poses]
        lm = np.full((num_poses, len(JOINTS), 3), np.nan, dtype=np.float32)
        for i, person in enumerate(people):
            lm[i] = person
        times.append(t)
        landmarks.append(lm)
        if len(times) % 300 == 0:
            print(f"  {t:6.1f}s  ({len(times) / (time.perf_counter() - t0):.1f} frames/s)", flush=True)

    elapsed = time.perf_counter() - t0
    meta = {
        "video": video.name, "width": width, "height": height, "fps": fps, "total_frames": total,
        "processed_frames": len(times), "start": start, "end": end, "num_poses": num_poses,
        "backend": backend.name, "joints": JOINTS,
        "seconds": round(elapsed, 1), "frames_per_second": round(len(times) / max(elapsed, 1e-9), 1),
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, times=np.array(times), landmarks=np.array(landmarks), meta=json.dumps(meta))
    return meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--backend", choices=["mediapipe", "rtmo"], default="rtmo")
    parser.add_argument("--rtmo-size", choices=["s", "m"], default="m")
    parser.add_argument("--score-thr", type=float, default=0.3, help="RTMO person confidence threshold")
    parser.add_argument("--num-poses", type=int, default=4, help="max people per frame (fighters + bystanders)")
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, default=None)
    args = parser.parse_args()
    backend = MediaPipeBackend(args.num_poses) if args.backend == "mediapipe" else RTMOBackend(args.rtmo_size, args.score_thr)
    meta = extract(args.video, args.out, backend, args.num_poses, args.start, args.end)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
