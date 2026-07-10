#!/usr/bin/env python3
"""Measure lightweight visual/motion targets from a reference video.

This script mirrors the browser-side cinematic frame QA at a coarse level:
sample frames, measure luma/sharpness, estimate optical-flow motion, and report
the highest-energy 4-second windows. It is intended for calibrating cinematic
reference profiles, not for full perceptual video analysis.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def average(values: list[float]) -> float:
    return float(np.mean(values)) if values else 0.0


def percentile(values: list[float], amount: float) -> float:
    return float(np.percentile(np.array(values), amount)) if values else 0.0


def analyze_reference_video(path: Path, samples_per_second: float = 2.0) -> dict[str, Any]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open reference video: {path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, int(round(fps / max(0.1, samples_per_second))))
    previous_gray: np.ndarray | None = None
    rows: list[dict[str, float]] = []
    sharpness: list[float] = []
    lumas: list[float] = []
    dark_ratios: list[float] = []
    crushed_black_ratios: list[float] = []
    highlight_ratios: list[float] = []
    sampled_count = 0
    frame_index = 0

    while True:
        ok = cap.grab()
        if not ok:
            break

        if frame_index % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break

            height, width = frame.shape[:2]
            target_width = 160
            target_height = max(1, round(height * target_width / max(1, width)))
            small = cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            sharpness.append(float(cv2.Laplacian(gray, cv2.CV_64F).var()))
            lumas.append(float(gray.mean()))
            dark_ratios.append(float((gray <= 36).mean()))
            crushed_black_ratios.append(float((gray <= 16).mean()))
            highlight_ratios.append(float((gray >= 235).mean()))

            if previous_gray is not None:
                delta = float(
                    np.mean(np.abs(gray.astype(np.float32) - previous_gray.astype(np.float32)))
                )
                flow = cv2.calcOpticalFlowFarneback(
                    previous_gray,
                    gray,
                    None,
                    0.5,
                    3,
                    15,
                    3,
                    5,
                    1.2,
                    0,
                )
                magnitude = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
                mean_abs_x = float(np.mean(np.abs(flow[..., 0])))
                mean_abs_y = float(np.mean(np.abs(flow[..., 1])))
                dominant = max(mean_abs_x, mean_abs_y)
                axis_balance = min(mean_abs_x, mean_abs_y) / dominant if dominant > 1e-6 else 1.0
                rows.append(
                    {
                        "time": frame_index / fps,
                        "delta": delta,
                        "motion": float(np.mean(magnitude)),
                        "x": mean_abs_x,
                        "y": mean_abs_y,
                        "axisBalance": axis_balance,
                    }
                )

            previous_gray = gray
            sampled_count += 1

        frame_index += 1

    cap.release()
    window_size = max(2, int(round(4 * samples_per_second)))
    windows: list[dict[str, float]] = []
    for index in range(0, max(0, len(rows) - window_size + 1)):
        chunk = rows[index : index + window_size]
        deltas = [row["delta"] for row in chunk]
        windows.append(
            {
                "start": chunk[0]["time"],
                "end": chunk[-1]["time"],
                "delta": average(deltas),
                "motion": average([row["motion"] for row in chunk]),
                "axisBalance": average([row["axisBalance"] for row in chunk]),
                "deltaStdDev": float(np.std(deltas)),
            }
        )

    windows.sort(
        key=lambda row: row["delta"] + row["motion"] * 8 + row["axisBalance"] * 10,
        reverse=True,
    )

    return {
        "file": str(path),
        "durationSeconds": round(frame_count / fps, 2) if fps else 0,
        "fps": fps,
        "frames": frame_count,
        "samples": sampled_count,
        "visual": {
            "sharpnessMean": round(average(sharpness), 2),
            "sharpnessP75": round(percentile(sharpness, 75), 2),
            "lumaMean": round(average(lumas), 2),
            "darkRatioMean": round(average(dark_ratios), 3),
            "crushedBlackRatioMean": round(average(crushed_black_ratios), 3),
            "highlightRatioMean": round(average(highlight_ratios), 3),
        },
        "motionAll": {
            "frameDeltaMean": round(average([row["delta"] for row in rows]), 2),
            "frameDeltaP75": round(percentile([row["delta"] for row in rows], 75), 2),
            "frameDeltaP90": round(percentile([row["delta"] for row in rows], 90), 2),
            "motionMean": round(average([row["motion"] for row in rows]), 3),
            "motionP75": round(percentile([row["motion"] for row in rows], 75), 3),
            "motionP90": round(percentile([row["motion"] for row in rows], 90), 3),
            "axisBalanceMean": round(average([row["axisBalance"] for row in rows]), 3),
            "axisBalanceP75": round(percentile([row["axisBalance"] for row in rows], 75), 3),
        },
        "topMotionWindows": [
            {
                key: round(value, 3) if isinstance(value, float) else value
                for key, value in window.items()
            }
            for window in windows[:12]
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--samples-per-second", type=float, default=2.0)
    args = parser.parse_args()
    print(
        json.dumps(
            analyze_reference_video(args.video, samples_per_second=args.samples_per_second),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
