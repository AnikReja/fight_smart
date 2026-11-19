"""Run the full pipeline (pose → appearance → analyze → overlay) on every video in a folder.

  python -m fightsmart_cv.batch output/pro

For each clip.mp4 it writes clip.npz and clip/ (summary.json, candidates.json, overlay.mp4), skipping clips
whose poses already exist, then prints one comparison table.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}


def run(*args: str) -> None:
    subprocess.run([sys.executable, "-m", *args], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--rtmo-size", choices=["s", "m"], default="s")
    parser.add_argument("--max-seconds", type=float, default=None, help="only process the first N seconds of each clip")
    args = parser.parse_args()

    videos = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in VIDEO_EXTS)
    if not videos:
        raise SystemExit(f"No videos in {args.folder}")
    rows = []
    for video in videos:
        poses, out = video.with_suffix(".npz"), video.with_suffix("")
        print(f"\n=== {video.name}", flush=True)
        if not poses.exists():
            extra = ["--end", str(args.max_seconds)] if args.max_seconds else []
            run("fightsmart_cv.pose", str(video), "--backend", "rtmo", "--rtmo-size", args.rtmo_size, "--out", str(poses), *extra)
        if not poses.with_name(poses.stem + "_appearance.npy").exists():
            run("fightsmart_cv.appearance", str(video), str(poses))
        run("fightsmart_cv.analyze", str(poses), "--out", str(out))
        run("fightsmart_cv.overlay", str(video), str(poses), str(out), "--out", str(out / "overlay.mp4"))
        s = json.loads((out / "summary.json").read_text(encoding="utf-8"))
        rows.append(s)

    print("\n| Clip | Frames | Speed | Both tracked | Arms usable A | Arms usable B | Candidates/min A / B |")
    print("|---|---|---|---|---|---|---|")
    for s in rows:
        a, b = s["fighters"]["A"], s["fighters"]["B"]
        arms = lambda f: f"{min(f['left_arm_usable'], f['right_arm_usable']):.0%}–{max(f['left_arm_usable'], f['right_arm_usable']):.0%}"
        print(f"| {s['video']} | {s['frames']} | {s['pose_speed_fps']} fps | {s['both_fighters_tracked']:.0%} | "
              f"{arms(a)} | {arms(b)} | {a['per_minute']} / {b['per_minute']} |")


if __name__ == "__main__":
    main()
