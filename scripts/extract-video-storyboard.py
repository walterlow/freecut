#!/usr/bin/env python3
"""Extract a timecoded contact sheet from a local video for visual QA."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import cv2
import numpy as np


def parse_times(value: str) -> list[float]:
    times = [float(part.strip()) for part in value.split(",") if part.strip()]
    if not times:
        raise argparse.ArgumentTypeError("Provide at least one timestamp.")
    return times


def extract_storyboard(
    video_path: Path,
    output_path: Path,
    times: list[float],
    columns: int,
    tile_width: int,
) -> None:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    source_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or tile_width)
    source_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or round(tile_width * 9 / 16))
    tile_height = max(1, round(source_height * tile_width / max(1, source_width)))
    label_height = 34
    tiles: list[np.ndarray] = []

    for timestamp in times:
        capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp) * 1000)
        ok, frame = capture.read()
        if not ok:
            raise RuntimeError(f"Could not decode {video_path} at {timestamp:.2f}s")

        resized = cv2.resize(frame, (tile_width, tile_height), interpolation=cv2.INTER_AREA)
        tile = np.zeros((tile_height + label_height, tile_width, 3), dtype=np.uint8)
        tile[label_height:, :] = resized
        cv2.putText(
            tile,
            f"{timestamp:.2f}s",
            (10, 23),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.58,
            (235, 235, 235),
            1,
            cv2.LINE_AA,
        )
        tiles.append(tile)

    capture.release()
    columns = max(1, min(columns, len(tiles)))
    rows = math.ceil(len(tiles) / columns)
    sheet = np.zeros((rows * (tile_height + label_height), columns * tile_width, 3), dtype=np.uint8)
    for index, tile in enumerate(tiles):
        row, column = divmod(index, columns)
        y = row * (tile_height + label_height)
        x = column * tile_width
        sheet[y : y + tile.shape[0], x : x + tile.shape[1]] = tile

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(output_path), sheet):
        raise RuntimeError(f"Could not write storyboard: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--times", type=parse_times, required=True)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--tile-width", type=int, default=480)
    args = parser.parse_args()
    extract_storyboard(
        args.video,
        args.output,
        args.times,
        columns=args.columns,
        tile_width=args.tile_width,
    )
    print(args.output.resolve())


if __name__ == "__main__":
    main()
