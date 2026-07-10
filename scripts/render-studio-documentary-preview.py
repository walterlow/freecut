#!/usr/bin/env python3
"""Render a fast Studio Documentary review cut from the Bellmere stills."""

from __future__ import annotations

import argparse
import math
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
PLATES_DIR = ROOT / "outputs" / "capcut-v4-plates"
DEFAULT_OUTPUT = ROOT / "outputs" / "bellmere-studio-documentary-preview-silent.mp4"
WIDTH, HEIGHT, FPS = 1920, 1080, 30
FRAMES_PER_SHOT = 90

SHOTS = [
    ("shot01_exterior_wide", Path(r"C:\Users\nicol\Downloads\ChatGPT Image Apr 30, 2026, 07_18_02 PM (5).png"), "BELL MERE"),
    ("shot02_workshop_reveal", Path(r"C:\Users\nicol\Downloads\ChatGPT Image Apr 30, 2026, 07_18_00 PM (2).png"), "WHEN THE MOON FORGETS TO TURN"),
    ("shot03_key_closeup", Path(r"C:\Users\nicol\Downloads\ChatGPT Image Apr 30, 2026, 07_18_01 PM (3).png"), "A KEY FOR THE FUTURE"),
    ("shot04_exterior_hero", Path(r"C:\Users\nicol\Downloads\ChatGPT Image Apr 30, 2026, 07_18_02 PM (4).png"), "THE CITY REMEMBERS"),
]


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def resize_cover(image: np.ndarray, interpolation: int) -> np.ndarray:
    source_h, source_w = image.shape[:2]
    scale = max(WIDTH / source_w, HEIGHT / source_h)
    resized_w = int(math.ceil(source_w * scale))
    resized_h = int(math.ceil(source_h * scale))
    resized = cv2.resize(image, (resized_w, resized_h), interpolation=interpolation)
    left = max(0, (resized_w - WIDTH) // 2)
    top = max(0, (resized_h - HEIGHT) // 2)
    return resized[top : top + HEIGHT, left : left + WIDTH].copy()


def finish(image: np.ndarray) -> np.ndarray:
    lifted = np.clip(image.astype(np.float32) * 1.018 + 3.0, 0, 255).astype(np.uint8)
    blur = cv2.GaussianBlur(lifted, (0, 0), 0.7)
    crisp = cv2.addWeighted(lifted, 1.30, blur, -0.30, 0)
    return np.clip(crisp, 0, 255).astype(np.uint8)


def load_layers(source_path: Path, shot_name: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    source = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
    background = cv2.imread(str(PLATES_DIR / shot_name / "background-clean.png"), cv2.IMREAD_COLOR)
    foreground = cv2.imread(str(PLATES_DIR / shot_name / "foreground-subject.png"), cv2.IMREAD_UNCHANGED)
    if source is None or background is None or foreground is None:
        raise FileNotFoundError(f"Missing source or depth plate for {shot_name}")

    source = resize_cover(source, cv2.INTER_LANCZOS4)
    background = resize_cover(background, cv2.INTER_LANCZOS4)
    if foreground.shape[2] == 4:
        alpha = resize_cover(foreground[:, :, 3], cv2.INTER_LANCZOS4)
    else:
        alpha = np.full((HEIGHT, WIDTH), 255, dtype=np.uint8)

    removal = cv2.GaussianBlur(cv2.dilate(alpha, np.ones((11, 11), np.uint8)), (0, 0), 4.5)
    removal_f = (removal.astype(np.float32) / 255.0)[:, :, None] * 0.9
    clean_background = np.clip(
        source.astype(np.float32) * (1.0 - removal_f) + background.astype(np.float32) * removal_f,
        0,
        255,
    ).astype(np.uint8)
    return finish(clean_background), finish(source), cv2.GaussianBlur(alpha, (0, 0), 0.3)


def motion(shot_index: int, progress: float) -> tuple[float, float, float]:
    t = smoothstep(progress)
    moves = [
        (0.045 * t, -0.025 * t, 0.0),
        (-0.035 * t, 0.012 * t, 0.0),
        (0.028 * t, -0.018 * t, 0.0),
        (-0.022 * t, 0.02 * t, 0.0),
    ]
    return moves[shot_index % len(moves)]


def matrix(scale: float, pan_x: float, pan_y: float) -> np.ndarray:
    return cv2.getRotationMatrix2D((WIDTH * 0.5, HEIGHT * 0.5), 0.0, scale).astype(np.float32) + np.array(
        [[0.0, 0.0, pan_x], [0.0, 0.0, pan_y]], dtype=np.float32
    )


def warp_color(image: np.ndarray, transform: np.ndarray) -> np.ndarray:
    return cv2.warpAffine(image, transform, (WIDTH, HEIGHT), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT_101)


def warp_rgba(rgb: np.ndarray, alpha: np.ndarray, transform: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return (
        cv2.warpAffine(rgb, transform, (WIDTH, HEIGHT), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT_101),
        cv2.warpAffine(alpha, transform, (WIDTH, HEIGHT), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT),
    )


def composite(base: np.ndarray, layer: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    weight = alpha.astype(np.float32)[:, :, None] / 255.0
    return np.clip(layer.astype(np.float32) * weight + base.astype(np.float32) * (1.0 - weight), 0, 255).astype(np.uint8)


def draw_title(frame: np.ndarray, title: str, progress: float) -> np.ndarray:
    fade = min(1.0, progress / 0.12, (1.0 - progress) / 0.14)
    if fade <= 0:
        return frame
    image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font_path = r"C:\Windows\Fonts\georgiab.ttf"
    font = ImageFont.truetype(font_path, 54 if len(title) < 18 else 34)
    box = draw.textbbox((0, 0), title, font=font)
    x = (WIDTH - (box[2] - box[0])) // 2
    y = int(HEIGHT * 0.78)
    draw.text((x + 2, y + 2), title, font=font, fill=(0, 0, 0, int(150 * fade)))
    draw.text((x, y), title, font=font, fill=(248, 230, 184, int(245 * fade)))
    image.alpha_composite(overlay)
    return cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--ffmpeg", default="ffmpeg")
    return parser.parse_args()


def render(args: argparse.Namespace) -> Path:
    output = Path(args.out).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    encoder = subprocess.Popen(
        [args.ffmpeg, "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)],
        stdin=subprocess.PIPE,
    )
    try:
        for shot_index, (shot_name, source_path, title) in enumerate(SHOTS):
            background, foreground, alpha = load_layers(source_path, shot_name)
            for frame_index in range(FRAMES_PER_SHOT):
                progress = frame_index / max(1, FRAMES_PER_SHOT - 1)
                pan_x, pan_y, _ = motion(shot_index, progress)
                base = warp_color(background, matrix(1.01 + 0.045 * smoothstep(progress), pan_x * WIDTH * 0.7, pan_y * HEIGHT * 0.7))
                subject, subject_alpha = warp_rgba(foreground, alpha, matrix(1.015 + 0.06 * smoothstep(progress), pan_x * WIDTH, pan_y * HEIGHT))
                frame = composite(base, subject, subject_alpha)
                frame = draw_title(finish(frame), title, progress)
                assert encoder.stdin is not None
                encoder.stdin.write(frame.tobytes())
    finally:
        if encoder.stdin:
            encoder.stdin.close()
        if encoder.wait() != 0:
            raise RuntimeError("ffmpeg video encode failed")
    return output


if __name__ == "__main__":
    print(render(parse_args()))
