#!/usr/bin/env python3
"""Generate a cinematic SFX review mix for an audiobook narration.

This helper is intentionally local and deterministic. It uses the narration
transcript when available, layers real local SFX assets where present, fills the
gaps with procedural Foley/impact design, then masters the result with ducking
around the voice. It is a preview of the direction the app should pursue, not a
replacement for licensed studio Foley libraries.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np


SR = 48_000
CHANNELS = 2
DEFAULT_DOWNLOADS = Path(r"C:\Users\nicol\Downloads")
DEFAULT_TRANSCRIPT = Path(r"C:\Users\nicol\Downloads\video editor\full_story_opening_5min_whisper.json")


@dataclass
class Cue:
    label: str
    start: float
    duration: float
    role: str
    source_text: str


@dataclass(frozen=True)
class TranscriptSegment:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class LocalAssets:
    whoosh: np.ndarray | None
    swell: np.ndarray | None
    ambience: np.ndarray | None
    score: np.ndarray | None


def run(command: list[str], input_bytes: bytes | None = None) -> None:
    subprocess.run(command, input=input_bytes, check=True)


def ffmpeg_decode(path: Path, duration: float | None = None) -> np.ndarray:
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    if duration is not None:
        command += ["-t", f"{duration:.3f}"]
    command += [
        "-i",
        str(path),
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "-ac",
        str(CHANNELS),
        "-ar",
        str(SR),
        "-",
    ]
    raw = subprocess.check_output(command)
    data = np.frombuffer(raw, dtype=np.float32)
    return data.reshape((-1, CHANNELS)) if len(data) else np.zeros((0, CHANNELS), dtype=np.float32)


def decode_audio(path: Path, duration: float) -> np.ndarray:
    return ffmpeg_decode(path, duration=duration)


def write_wav(path: Path, audio: np.ndarray) -> None:
    clean = np.clip(np.nan_to_num(audio, nan=0.0, posinf=0.96, neginf=-0.96), -0.96, 0.96)
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "f32le",
        "-ar",
        str(SR),
        "-ac",
        str(CHANNELS),
        "-i",
        "-",
        "-c:a",
        "pcm_s24le",
        str(path),
    ]
    run(command, clean.astype(np.float32).tobytes())


def render_mp3_mix(
    input_path: Path,
    bed_stem_path: Path,
    event_stem_path: Path,
    output_path: Path,
    duration: float,
) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(input_path),
        "-i",
        str(bed_stem_path),
        "-i",
        str(event_stem_path),
        "-filter_complex",
        "[2:a]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,"
        "highpass=f=24,lowpass=f=19500,volume=1.24,"
        "acompressor=threshold=0.18:ratio=1.08:attack=2.2:release=210:makeup=1.0,"
        "alimiter=limit=0.86:attack=0.6:release=90[eventsraw];"
        "[eventsraw]asplit=2[events][eventsc];"
        "[0:a]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,volume=0.98[nraw];"
        "[nraw][eventsc]sidechaincompress=threshold=0.043:ratio=1.42:attack=5:release=320:makeup=1.0[n];"
        "[1:a]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,"
        "highpass=f=30,lowpass=f=15000,volume=1.06[bedraw];"
        "[bedraw][n]sidechaincompress=threshold=0.038:ratio=3.8:attack=14:release=680:makeup=1.04[bed];"
        "[n][bed][events]amix=inputs=3:duration=first:normalize=0,"
        "alimiter=limit=0.94:attack=1:release=85,"
        "loudnorm=I=-16.2:TP=-1.4:LRA=11:print_format=summary[a]",
        "-map",
        "[a]",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "320k",
        str(output_path),
    ]
    run(command)


def render_wav_mix(
    input_path: Path,
    bed_stem_path: Path,
    event_stem_path: Path,
    output_path: Path,
    duration: float,
) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(input_path),
        "-i",
        str(bed_stem_path),
        "-i",
        str(event_stem_path),
        "-filter_complex",
        "[2:a]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,"
        "highpass=f=24,lowpass=f=19500,volume=1.24,"
        "acompressor=threshold=0.18:ratio=1.08:attack=2.2:release=210:makeup=1.0,"
        "alimiter=limit=0.86:attack=0.6:release=90[eventsraw];"
        "[eventsraw]asplit=2[events][eventsc];"
        "[0:a]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,volume=0.98[nraw];"
        "[nraw][eventsc]sidechaincompress=threshold=0.043:ratio=1.42:attack=5:release=320:makeup=1.0[n];"
        "[1:a]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,"
        "highpass=f=30,lowpass=f=15000,volume=1.06[bedraw];"
        "[bedraw][n]sidechaincompress=threshold=0.038:ratio=3.8:attack=14:release=680:makeup=1.04[bed];"
        "[n][bed][events]amix=inputs=3:duration=first:normalize=0,"
        "alimiter=limit=0.94:attack=1:release=85,"
        "loudnorm=I=-16.2:TP=-1.4:LRA=11:print_format=summary[a]",
        "-map",
        "[a]",
        "-ar",
        str(SR),
        "-c:a",
        "pcm_s24le",
        str(output_path),
    ]
    run(command)


def rms(audio: np.ndarray) -> float:
    return float(np.sqrt(np.mean(audio * audio) + 1e-12))


def db_to_gain(db: float) -> float:
    return 10 ** (db / 20)


def fade_curve(length: int, attack: float, release: float) -> np.ndarray:
    env = np.ones(length, dtype=np.float32)
    attack_frames = max(1, min(length, round(attack * SR)))
    release_frames = max(1, min(length, round(release * SR)))
    env[:attack_frames] *= np.linspace(0, 1, attack_frames, dtype=np.float32)
    env[-release_frames:] *= np.linspace(1, 0, release_frames, dtype=np.float32)
    return env


def match_rms(audio: np.ndarray, target_db: float, max_gain_db: float = 24) -> np.ndarray:
    level = rms(audio)
    if level <= 1e-8:
        return audio
    gain = min(db_to_gain(max_gain_db), db_to_gain(target_db) / level)
    return audio * gain


def one_pole_lowpass(signal: np.ndarray, alpha: float) -> np.ndarray:
    out = np.empty_like(signal)
    last = 0.0
    for index, sample in enumerate(signal):
        last += alpha * (sample - last)
        out[index] = last
    return out


def highpass(signal: np.ndarray, alpha: float) -> np.ndarray:
    return signal - one_pole_lowpass(signal, alpha)


def bandpass_noise(length: int, rng: np.random.Generator, low_alpha: float, high_alpha: float) -> np.ndarray:
    noise = rng.normal(0, 1, length).astype(np.float32)
    return highpass(one_pole_lowpass(noise, high_alpha), low_alpha)


def soft_limit(audio: np.ndarray, drive: float = 1.25) -> np.ndarray:
    normalizer = math.tanh(drive)
    return (np.tanh(audio * drive) / normalizer).astype(np.float32)


def add_studio_tail(audio: np.ndarray, wet: float) -> np.ndarray:
    if wet <= 0 or len(audio) == 0:
        return audio.astype(np.float32)

    result = audio.copy()
    taps = (
        (0.031, 0.22),
        (0.067, 0.17),
        (0.131, 0.12),
        (0.239, 0.08),
    )
    for delay_seconds, gain in taps:
        delay = round(delay_seconds * SR)
        if delay <= 0 or delay >= len(result):
            continue
        result[delay:, 0] += audio[:-delay, 1] * gain * wet
        result[delay:, 1] += audio[:-delay, 0] * gain * wet * 0.94
    return result.astype(np.float32)


def stereo_pan(mono: np.ndarray, pan: float) -> np.ndarray:
    pan = float(np.clip(pan, -1, 1))
    left = math.cos((pan + 1) * math.pi / 4)
    right = math.sin((pan + 1) * math.pi / 4)
    return np.column_stack([mono * left, mono * right]).astype(np.float32)


def stereo_widen(audio: np.ndarray, amount: float) -> np.ndarray:
    if len(audio) == 0:
        return audio.astype(np.float32)
    left = audio[:, 0]
    right = audio[:, 1]
    mid = (left + right) * 0.5
    side = (left - right) * 0.5 * amount
    return np.column_stack([mid + side, mid - side]).astype(np.float32)


def add_clip(target: np.ndarray, start_seconds: float, clip: np.ndarray) -> None:
    start = max(0, round(start_seconds * SR))
    if start >= len(target):
        return
    end = min(len(target), start + len(clip))
    target[start:end] += clip[: end - start]


def trim_or_pad(audio: np.ndarray, duration: float) -> np.ndarray:
    length = max(1, round(duration * SR))
    if len(audio) >= length:
        return audio[:length].copy()
    result = np.zeros((length, CHANNELS), dtype=np.float32)
    result[: len(audio)] = audio
    return result


def load_asset(path: Path, target_db: float, fade_in: float, fade_out: float) -> np.ndarray | None:
    if not path.exists():
        return None
    audio = ffmpeg_decode(path)
    if len(audio) == 0:
        return None
    audio = match_rms(audio, target_db)
    audio *= fade_curve(len(audio), fade_in, fade_out)[:, None]
    return audio.astype(np.float32)


def load_local_assets(downloads_dir: Path) -> LocalAssets:
    return LocalAssets(
        whoosh=load_asset(
            downloads_dir / "descent-whoosh-long-cinematic-sound-effect-405921.mp3",
            target_db=-15.8,
            fade_in=0.035,
            fade_out=0.45,
        ),
        swell=load_asset(
            downloads_dir / "mixkit-cinematic-suspense-swell-786.wav",
            target_db=-18.0,
            fade_in=0.16,
            fade_out=1.1,
        ),
        ambience=load_asset(
            downloads_dir / "ambience.wav",
            target_db=-32.0,
            fade_in=1.5,
            fade_out=2.0,
        ),
        score=load_asset(
            downloads_dir
            / "epic-cinematic-piano-amp-strings-motivational-background-music-013-447621.mp3",
            target_db=-33.5,
            fade_in=1.8,
            fade_out=2.5,
        ),
    )


def time_value(value: float) -> float:
    return value / 1000 if value > 300 else value


def parse_transcript_line(line: str) -> TranscriptSegment | None:
    try:
        data = json.loads(line)
        return TranscriptSegment(
            start=time_value(float(data["start"])),
            end=time_value(float(data["end"])),
            text=str(data.get("text", "")).strip(),
        )
    except json.JSONDecodeError:
        start_match = line.split('"start":', 1)
        end_match = line.split('"end":', 1)
        text_match = line.split('"text":"', 1)
        if len(start_match) < 2 or len(end_match) < 2 or len(text_match) < 2:
            return None
        try:
            start = float(start_match[1].split(",", 1)[0])
            end = float(end_match[1].split(",", 1)[0])
        except ValueError:
            return None
        text = text_match[1]
        if text.endswith('"}'):
            text = text[:-2]
        return TranscriptSegment(start=time_value(start), end=time_value(end), text=text.strip())


def load_transcript(path: Path) -> list[TranscriptSegment]:
    if not path.exists():
        return []

    segments: list[TranscriptSegment] = []
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip():
            continue
        segment = parse_transcript_line(line)
        if segment is not None:
            segments.append(segment)
    return segments


def has_any(text: str, terms: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in terms)


def power_hit_label(text: str) -> str:
    lowered = text.lower()
    if has_any(lowered, ("dominique", "dominic", "voss", "forbes", "cover", "named")):
        return "Name-card reveal hit"
    if has_any(lowered, ("senator", "senators", "federal", "judge", "committee", "public")):
        return "Institutional power hit"
    if has_any(lowered, ("privacy", "client", "clients", "agency", "discretion", "leverage")):
        return "Private leverage hit"
    return "Political thriller reveal hit"


def decision_hit_label(text: str) -> str:
    lowered = text.lower()
    if has_any(lowered, ("choice", "decision", "accepted", "resistance", "objection")):
        return "Choice rupture hit"
    if has_any(lowered, ("secret", "truth", "hidden", "warning", "danger")):
        return "Truth pressure hit"
    return "Suspense story-turn hit"


def add_spaced(
    cues: list[Cue],
    cue: Cue,
    min_spacing: float = 2.2,
    max_per_label: int | None = None,
    allow_overlap: bool = False,
) -> None:
    if cue.start < 0:
        return
    if max_per_label is not None and sum(existing.label == cue.label for existing in cues) >= max_per_label:
        return
    if not allow_overlap and any(
        abs(existing.start - cue.start) < min_spacing
        and existing.role != "ambience"
        and cue.role != "ambience"
        for existing in cues
    ):
        return
    cues.append(cue)


def build_cues(segments: list[TranscriptSegment], duration: float) -> list[Cue]:
    cues: list[Cue] = [
        Cue("Studio noir room tone", 0, duration, "ambience", "continuous investigative ambience")
    ]

    opening_terms = ("selling the", "epigraph", "prologue")
    chapter_terms = ("part 1", "chapter")
    paper_terms = ("manila folder", "folder", "first page", "opened", "closed it", "page")
    phone_terms = ("texting", "texted", "phone", "source through a phone", "wedged")
    office_terms = ("assignment", "journalist", "editor", "source", "interviewed", "filed", "words")
    story_texture_terms = ("wedding", "cult", "bathroom", "apartment", "ferrets", "objection")
    power_terms = ("senator", "federal", "judge", "forbes", "public", "agency", "client", "privacy")
    decision_terms = ("undercover", "objection", "resistance", "certainty", "decision", "truth", "secret", "policy")
    opening_sting_added = False
    chapter_sting_added = False

    for segment in segments:
        text = segment.text
        if has_any(text, opening_terms) and not opening_sting_added:
            add_spaced(
                cues,
                Cue("Elegant title-card sting", segment.start + 0.15, 2.4, "transition", text),
                4.5,
                max_per_label=1,
            )
            opening_sting_added = True
        if has_any(text, chapter_terms) and not chapter_sting_added:
            add_spaced(
                cues,
                Cue("Elegant chapter transition", segment.start + 0.05, 2.6, "transition", text),
                12.0,
                max_per_label=1,
            )
            chapter_sting_added = True
        if has_any(text, phone_terms):
            add_spaced(
                cues,
                Cue("Close phone and keyboard Foley", segment.start, 1.7, "foreground", text),
                5.0,
                max_per_label=4,
            )
        if has_any(text, office_terms):
            add_spaced(
                cues,
                Cue("Investigative office texture", segment.start + 0.05, 2.2, "foreground", text),
                10.0,
                max_per_label=7,
            )
        if has_any(text, story_texture_terms):
            add_spaced(
                cues,
                Cue("Story-world texture accent", segment.start + 0.06, 2.0, "foreground", text),
                12.0,
                max_per_label=5,
            )
        if has_any(text, paper_terms):
            add_spaced(
                cues,
                Cue("Close folder and paper Foley", segment.start, 1.35, "foreground", text),
                2.8,
                max_per_label=5,
            )
        if has_any(text, power_terms):
            add_spaced(
                cues,
                Cue(power_hit_label(text), segment.start + 0.14, 2.5, "impact", text),
                5.2,
                max_per_label=4,
            )
        if has_any(text, decision_terms):
            add_spaced(
                cues,
                Cue(decision_hit_label(text), segment.start + 0.08, 2.3, "impact", text),
                6.0,
                max_per_label=4,
            )

    for anchor in (31.0, 50.6, 98.3, 139.9, 154.8, 181.6, 223.3, 259.1, 291.8):
        if anchor < duration - 1:
            add_spaced(
                cues,
                Cue("Director punctuation hit", anchor, 2.25, "impact", "editorial story beat"),
                8.0,
                max_per_label=8,
            )

    for anchor in (18.5, 44.0, 74.5, 115.0, 168.0, 205.5, 244.0, 276.0):
        if anchor < duration - 1:
            add_spaced(
                cues,
                Cue("Scene pressure lift", anchor, 3.2, "foreground", "editorial scene pressure"),
                7.0,
                max_per_label=8,
            )

    return sorted(cues, key=lambda cue: cue.start)


def make_asset_whoosh(
    duration: float,
    assets: LocalAssets,
    rng: np.random.Generator,
    amp: float,
    reverse: bool,
) -> np.ndarray:
    if assets.whoosh is not None:
        clip = trim_or_pad(assets.whoosh[::-1] if reverse else assets.whoosh, duration)
        return (clip * amp * fade_curve(len(clip), 0.03, 0.34)[:, None]).astype(np.float32)

    n = round(duration * SR)
    progress = np.linspace(0, 1, n, dtype=np.float32)
    env = np.maximum(0, np.sin(progress * math.pi)) ** 1.85
    if reverse:
        env = env[::-1]
    air = bandpass_noise(n, rng, low_alpha=0.035, high_alpha=0.22)
    body = one_pole_lowpass(rng.normal(0, 1, n).astype(np.float32), 0.002)
    mono = (air * 0.95 + body * 0.5) * env * amp
    return stereo_pan(mono, rng.uniform(-0.35, 0.35))


def make_asset_swell(duration: float, assets: LocalAssets, rng: np.random.Generator, amp: float) -> np.ndarray:
    if assets.swell is not None:
        clip = trim_or_pad(assets.swell, duration)
        return (clip * amp * fade_curve(len(clip), 0.25, 0.8)[:, None]).astype(np.float32)

    n = round(duration * SR)
    t = np.arange(n, dtype=np.float32) / SR
    progress = np.linspace(0, 1, n, dtype=np.float32)
    tone = np.sin(2 * math.pi * (42 + progress * 16) * t)
    air = bandpass_noise(n, rng, low_alpha=0.02, high_alpha=0.1)
    env = np.minimum(1, progress / 0.78) ** 1.8
    mono = (tone * 0.32 + air * 0.7) * env * amp
    return stereo_pan(mono, rng.uniform(-0.25, 0.25))


def make_room_slap(duration: float, rng: np.random.Generator, amp: float = 0.22) -> np.ndarray:
    n = round(duration * SR)
    if n <= 0:
        return np.zeros((0, CHANNELS), dtype=np.float32)

    t = np.arange(n, dtype=np.float32) / SR
    noise = rng.normal(0, 1, n).astype(np.float32)
    tail = bandpass_noise(n, rng, low_alpha=0.006, high_alpha=0.055) * np.exp(-1.55 * t)
    early = np.zeros(n, dtype=np.float32)
    for delay_seconds, gain in (
        (0.013, 0.9),
        (0.027, 0.62),
        (0.046, 0.43),
        (0.083, 0.3),
        (0.141, 0.22),
    ):
        start = min(n, round(delay_seconds * SR))
        burst_len = min(n - start, round(0.018 * SR))
        if burst_len <= 0:
            continue
        burst = highpass(noise[start : start + burst_len], 0.18)
        early[start : start + burst_len] += burst * fade_curve(burst_len, 0.001, 0.014) * gain

    left = (tail + early) * amp
    right = (np.roll(tail, round(0.006 * SR)) * 0.92 + np.roll(early, round(0.003 * SR)) * 0.78) * amp
    return soft_limit(np.column_stack([left, right]).astype(np.float32), 1.18)


def make_debris_scatter(duration: float, rng: np.random.Generator, amp: float = 0.16) -> np.ndarray:
    n = round(duration * SR)
    mono = np.zeros(n, dtype=np.float32)
    if n <= 0:
        return stereo_pan(mono, 0)

    for _ in range(max(5, round(duration * 12))):
        offset = float(rng.uniform(0.018, max(0.02, duration * 0.72)))
        start = min(n, round(offset * SR))
        burst_len = min(n - start, round(float(rng.uniform(0.012, 0.07)) * SR))
        if burst_len <= 0:
            continue
        t = np.arange(burst_len, dtype=np.float32) / SR
        grit = highpass(rng.normal(0, 1, burst_len).astype(np.float32), float(rng.uniform(0.12, 0.34)))
        body = np.sin(2 * math.pi * float(rng.uniform(360, 1250)) * t) * np.exp(-float(rng.uniform(26, 74)) * t)
        env = fade_curve(burst_len, 0.0015, float(rng.uniform(0.025, 0.07)))
        mono[start : start + burst_len] += (grit * 0.62 + body * 0.38) * env * amp * float(rng.uniform(0.45, 1.0))

    scrape_len = min(n, round(min(duration, 0.9) * SR))
    if scrape_len > 0:
        scrape = bandpass_noise(scrape_len, rng, low_alpha=0.045, high_alpha=0.42)
        scrape_env = np.maximum(0, np.sin(np.linspace(0, math.pi, scrape_len, dtype=np.float32))) ** 1.45
        mono[:scrape_len] += scrape * scrape_env * amp * 0.34

    return stereo_widen(stereo_pan(soft_limit(mono, 1.24), rng.uniform(-0.46, 0.46)), 1.18)


def make_story_tension_lift(duration: float, rng: np.random.Generator, amp: float = 0.18) -> np.ndarray:
    n = round(duration * SR)
    if n <= 0:
        return np.zeros((0, CHANNELS), dtype=np.float32)

    t = np.arange(n, dtype=np.float32) / SR
    progress = np.linspace(0, 1, n, dtype=np.float32)
    swell_env = np.minimum(1, progress / 0.82) ** 2.1
    air = bandpass_noise(n, rng, low_alpha=0.01, high_alpha=0.18)
    pressure = (
        np.sin(2 * math.pi * (32 + 9 * progress) * t + 0.12)
        + np.sin(2 * math.pi * (47 + 13 * progress) * t + 0.8) * 0.58
    )
    texture = highpass(rng.normal(0, 1, n).astype(np.float32), 0.075)
    pulse = (np.maximum(0, np.sin(2 * math.pi * (1.5 + 0.7 * progress) * t)) ** 3.4) * 0.18
    mono = (pressure * 0.48 + air * 0.74 + texture * pulse) * swell_env * amp
    return stereo_widen(stereo_pan(soft_limit(mono, 1.14), rng.uniform(-0.24, 0.24)), 1.38)


def make_close_desk_knock(duration: float, rng: np.random.Generator, amp: float = 0.16) -> np.ndarray:
    n = round(duration * SR)
    if n <= 0:
        return np.zeros((0, CHANNELS), dtype=np.float32)

    t = np.arange(n, dtype=np.float32) / SR
    wood = (
        np.sin(2 * math.pi * 132 * t) * np.exp(-18 * t)
        + np.sin(2 * math.pi * 214 * t + 0.4) * np.exp(-23 * t) * 0.54
        + np.sin(2 * math.pi * 386 * t + 1.1) * np.exp(-31 * t) * 0.25
    )
    snap = highpass(rng.normal(0, 1, n).astype(np.float32), 0.34) * np.exp(-62 * t) * 0.28
    mono = (wood + snap) * amp * fade_curve(n, 0.001, min(duration * 0.7, 0.18))
    return stereo_pan(soft_limit(mono, 1.18), rng.uniform(-0.24, 0.24))


def make_metal_latch(duration: float, rng: np.random.Generator, amp: float = 0.12) -> np.ndarray:
    n = round(duration * SR)
    mono = np.zeros(n, dtype=np.float32)
    if n <= 0:
        return stereo_pan(mono, 0)

    for offset, strength in ((0.012, 1.0), (0.054, 0.74), (0.118, 0.46), (0.24, 0.32)):
        start = round(offset * SR)
        if start >= n:
            continue
        length = min(n - start, round(float(rng.uniform(0.07, 0.18)) * SR))
        t = np.arange(length, dtype=np.float32) / SR
        click = highpass(rng.normal(0, 1, length).astype(np.float32), 0.42) * np.exp(-52 * t)
        ring = np.zeros(length, dtype=np.float32)
        for freq in (860, 1240, 1920, 2780):
            ring += (
                np.sin(2 * math.pi * (freq + rng.uniform(-22, 22)) * t + rng.uniform(0, math.pi))
                * np.exp(-float(rng.uniform(18, 36)) * t)
            )
        mono[start : start + length] += (click * 0.72 + ring * 0.16) * amp * strength

    scrape_len = min(n, round(0.82 * SR))
    if scrape_len > 0:
        scrape = bandpass_noise(scrape_len, rng, low_alpha=0.03, high_alpha=0.32)
        env = np.maximum(0, np.sin(np.linspace(0, math.pi, scrape_len, dtype=np.float32))) ** 1.8
        mono[:scrape_len] += scrape * env * amp * 0.22

    return stereo_widen(stereo_pan(soft_limit(mono, 1.22), rng.uniform(-0.35, 0.35)), 1.2)


def make_card_snap(duration: float, rng: np.random.Generator, amp: float = 0.14) -> np.ndarray:
    n = round(duration * SR)
    mono = np.zeros(n, dtype=np.float32)
    if n <= 0:
        return stereo_pan(mono, 0)

    for offset, strength in ((0.0, 1.0), (0.09, 0.62), (0.22, 0.35)):
        start = round(offset * SR)
        length = min(n - start, round(0.22 * SR))
        if length <= 0:
            continue
        t = np.arange(length, dtype=np.float32) / SR
        body = np.sin(2 * math.pi * 150 * t) * np.exp(-22 * t)
        edge = highpass(rng.normal(0, 1, length).astype(np.float32), 0.24) * np.exp(-34 * t)
        mono[start : start + length] += (body * 0.34 + edge * 0.66) * amp * strength

    brush_len = min(n, round(1.0 * SR))
    if brush_len > 0:
        brush = highpass(rng.normal(0, 1, brush_len).astype(np.float32), 0.08)
        env = fade_curve(brush_len, 0.018, 0.28)
        mono[:brush_len] += brush * env * amp * 0.16

    return stereo_widen(stereo_pan(soft_limit(mono, 1.18), rng.uniform(-0.4, 0.34)), 1.16)


def make_cloth_shift(duration: float, rng: np.random.Generator, amp: float = 0.1) -> np.ndarray:
    n = round(duration * SR)
    if n <= 0:
        return np.zeros((0, CHANNELS), dtype=np.float32)

    mono = np.zeros(n, dtype=np.float32)
    for offset in (0.05, 0.22, 0.48, 0.76):
        start = round(offset * SR)
        length = min(n - start, round(float(rng.uniform(0.28, 0.72)) * SR))
        if length <= 0:
            continue
        noise = rng.normal(0, 1, length).astype(np.float32)
        rub = one_pole_lowpass(highpass(noise, 0.025), 0.38)
        grit = highpass(rng.normal(0, 1, length).astype(np.float32), 0.18)
        env = np.maximum(0, np.sin(np.linspace(0, math.pi, length, dtype=np.float32))) ** 1.5
        mono[start : start + length] += (rub * 0.78 + grit * 0.18) * env * amp * rng.uniform(0.55, 1.0)

    return stereo_widen(stereo_pan(soft_limit(mono, 1.08), rng.uniform(-0.28, 0.28)), 1.12)


def make_practical_impact_texture(duration: float, rng: np.random.Generator, amp: float = 0.14) -> np.ndarray:
    texture = make_card_snap(duration, rng, amp=amp)
    texture += trim_or_pad(make_metal_latch(min(duration, 1.4), rng, amp=amp * 0.62), duration)
    texture += trim_or_pad(make_cloth_shift(min(duration, 1.7), rng, amp=amp * 0.5), duration)
    texture += trim_or_pad(make_close_desk_knock(min(duration, 0.55), rng, amp=amp * 0.72), duration)
    return soft_limit(stereo_widen(texture, 1.14), 1.1)


def make_impact(duration: float, rng: np.random.Generator, amp: float = 0.5) -> np.ndarray:
    n = round(duration * SR)
    t = np.arange(n, dtype=np.float32) / SR
    progress = np.clip(t / 1.55, 0, 1)
    sweep = 92 - 62 * (1 - np.exp(-3.4 * progress))
    phase = np.cumsum((2 * math.pi * sweep) / SR)

    sub = np.sin(phase) * np.exp(-1.58 * t) * amp * 1.58
    sub += np.sin(phase * 0.5 + 0.4) * np.exp(-1.08 * t) * amp * 0.42
    chest = (
        np.sin(2 * math.pi * 108 * t + 0.18) * np.exp(-3.05 * t) * 0.82
        + np.sin(2 * math.pi * 156 * t + 0.42) * np.exp(-4.7 * t) * 0.46
        + np.sin(2 * math.pi * 232 * t + 0.16) * np.exp(-7.8 * t) * 0.2
    ) * amp
    knock = np.sin(2 * math.pi * 276 * t) * np.exp(-17.5 * t) * amp * 0.46

    raw_noise = rng.normal(0, 1, n).astype(np.float32)
    transient = highpass(raw_noise, 0.38) * np.exp(-70 * t) * amp * 0.72
    crack = highpass(rng.normal(0, 1, n).astype(np.float32), 0.52) * np.exp(-34 * t) * amp * 0.26
    air = bandpass_noise(n, rng, low_alpha=0.014, high_alpha=0.21) * np.exp(-4.2 * t) * amp * 0.34
    pressure = one_pole_lowpass(rng.normal(0, 1, n).astype(np.float32), 0.0028)
    pressure = pressure * np.exp(-0.68 * t) * amp * 0.62

    metal = np.zeros(n, dtype=np.float32)
    for index, freq in enumerate((346, 521, 762, 1130, 1690)):
        start = round((0.012 + index * 0.018) * SR)
        if start >= n:
            continue
        local = t[: n - start]
        tone = np.sin(2 * math.pi * freq * local + rng.uniform(0, math.pi))
        metal[start:] += tone * np.exp(-(7.6 + index * 1.35) * local) * amp * max(0.018, 0.12 - index * 0.017)

    grit = highpass(rng.normal(0, 1, n).astype(np.float32), 0.18)
    grit_env = np.maximum(0, np.sin(np.linspace(0, math.pi, n, dtype=np.float32))) ** 0.55
    grit *= grit_env * np.exp(-2.8 * t) * amp * 0.11

    wood = (
        np.sin(2 * math.pi * 84 * t + 0.22) * np.exp(-8.8 * t) * 0.42
        + np.sin(2 * math.pi * 196 * t + 0.7) * np.exp(-15.5 * t) * 0.24
    ) * amp
    mono = (
        sub
        + chest
        + knock
        + transient
        + crack * 1.32
        + air
        + pressure
        + metal
        + grit * 1.28
        + wood
    ) * fade_curve(n, 0.0012, 1.05)
    hit = stereo_pan(soft_limit(mono, 1.46), rng.uniform(-0.18, 0.18))
    bloom = stereo_pan(
        one_pole_lowpass(rng.normal(0, 1, n).astype(np.float32), 0.0035)
        * np.exp(-0.72 * t)
        * amp
        * 0.28,
        rng.uniform(-0.08, 0.08),
    )
    scatter = make_debris_scatter(duration, rng, amp=amp * 0.2)
    slap = make_room_slap(duration, rng, amp=amp * 0.34)
    practical = make_practical_impact_texture(duration, rng, amp=amp * 0.12)
    return soft_limit(stereo_widen(hit + bloom + scatter + slap + practical, 1.34), 1.14)


def make_paper(duration: float, rng: np.random.Generator, amp: float = 0.18) -> np.ndarray:
    n = round(duration * SR)
    mono = np.zeros(n, dtype=np.float32)
    for offset in (0.01, 0.07, 0.12, 0.21, 0.29, 0.43, 0.51, 0.67, 0.76, 0.94):
        start = round(offset * SR)
        burst_len = min(n - start, round(rng.uniform(0.06, 0.18) * SR))
        if burst_len <= 0:
            continue
        noise = highpass(rng.normal(0, 1, burst_len).astype(np.float32), 0.06)
        rough = one_pole_lowpass(noise, 0.58)
        edge = highpass(rng.normal(0, 1, burst_len).astype(np.float32), 0.28)
        env = fade_curve(burst_len, 0.004, 0.055)
        mono[start : start + burst_len] += (rough * 0.78 + edge * 0.32) * env * amp * rng.uniform(0.65, 1.1)

    thump_len = min(n, round(0.18 * SR))
    t = np.arange(thump_len, dtype=np.float32) / SR
    mono[:thump_len] += np.sin(2 * math.pi * 116 * t) * np.exp(-18 * t) * amp * 0.64
    mono[:thump_len] += highpass(rng.normal(0, 1, thump_len).astype(np.float32), 0.28) * np.exp(-34 * t) * amp * 0.2
    paper = stereo_pan(soft_limit(mono, 1.16), rng.uniform(-0.42, 0.38))
    knock = trim_or_pad(make_close_desk_knock(min(duration, 0.42), rng, amp=amp * 0.55), duration)
    return soft_limit(paper + knock, 1.12)


def make_keyboard(duration: float, rng: np.random.Generator, amp: float = 0.1) -> np.ndarray:
    n = round(duration * SR)
    mono = np.zeros(n, dtype=np.float32)
    cursor = round(0.04 * SR)
    while cursor < n - 300:
        click_len = round(rng.uniform(0.009, 0.022) * SR)
        click_len = min(click_len, n - cursor)
        if click_len <= 0:
            break
        t = np.arange(click_len, dtype=np.float32) / SR
        tick = np.sin(2 * math.pi * rng.uniform(1500, 3100) * t) * np.exp(-130 * t)
        body = np.sin(2 * math.pi * rng.uniform(260, 620) * t) * np.exp(-58 * t)
        noise = highpass(rng.normal(0, 1, click_len).astype(np.float32), 0.2)
        plastic = one_pole_lowpass(noise, 0.5)
        mono[cursor : cursor + click_len] += (tick * 0.34 + body * 0.28 + noise * 0.46 + plastic * 0.16) * amp
        cursor += round(rng.uniform(0.038, 0.14) * SR)
    return stereo_widen(stereo_pan(soft_limit(mono, 1.2), rng.uniform(-0.3, 0.35)), 1.16)


def make_clock_detail(duration: float, rng: np.random.Generator, amp: float = 0.075) -> np.ndarray:
    n = round(duration * SR)
    mono = np.zeros(n, dtype=np.float32)
    for seconds in np.arange(0.08, duration, 0.5):
        start = round(seconds * SR)
        click_len = min(n - start, round(0.038 * SR))
        if click_len <= 0:
            continue
        t = np.arange(click_len, dtype=np.float32) / SR
        click = (
            np.sin(2 * math.pi * rng.uniform(1650, 2600) * t) * np.exp(-98 * t)
            + np.sin(2 * math.pi * 820 * t) * np.exp(-72 * t) * 0.36
        )
        mono[start : start + click_len] += click * amp
    return stereo_pan(mono, rng.uniform(-0.52, 0.52))


def make_shimmer(duration: float, rng: np.random.Generator, amp: float = 0.075) -> np.ndarray:
    n = round(duration * SR)
    mono = np.zeros(n, dtype=np.float32)
    for index, freq in enumerate((940, 1430, 2160, 3180)):
        start = round((0.06 + index * 0.08) * SR)
        for sample_index in range(start, n):
            local_time = (sample_index - start) / SR
            mono[sample_index] += (
                math.sin(2 * math.pi * freq * local_time)
                * math.exp(-3.6 * local_time)
                * amp
                * (0.9 - index * 0.12)
            )
    air = highpass(rng.normal(0, 1, n).astype(np.float32), 0.08) * fade_curve(n, 0.06, 0.65) * amp * 0.2
    return stereo_pan(soft_limit(mono + air, 1.05), rng.uniform(-0.25, 0.25))


def add_room_bed(target: np.ndarray, assets: LocalAssets, rng: np.random.Generator) -> None:
    length = len(target)
    time = np.arange(length, dtype=np.float32) / SR
    bed = np.zeros_like(target)

    if assets.ambience is not None and len(assets.ambience) > 0:
        indices = np.arange(length) % len(assets.ambience)
        bed += assets.ambience[indices] * 0.82

    if assets.score is not None and len(assets.score) > 0:
        indices = np.arange(length) % len(assets.score)
        score = assets.score[indices] * 0.42
        bed += score * fade_curve(length, 2.4, 3.4)[:, None]

    left_noise = rng.normal(0, 1, length).astype(np.float32)
    right_noise = rng.normal(0, 1, length).astype(np.float32)
    office_air = np.column_stack(
        [
            highpass(left_noise, 0.018) * 0.0024 + one_pole_lowpass(left_noise, 0.00035) * 0.016,
            highpass(right_noise, 0.019) * 0.0022 + one_pole_lowpass(right_noise, 0.00032) * 0.015,
        ]
    ).astype(np.float32)
    pressure = (
        np.sin(2 * math.pi * 47 * time) * 0.0026
        + np.sin(2 * math.pi * 72 * time + 0.6) * 0.0021
    ).astype(np.float32)
    bed += office_air
    bed[:, 0] += pressure
    bed[:, 1] += pressure * 0.92

    for start in np.arange(42, length / SR, 18.5):
        add_clip(bed, float(start), make_keyboard(2.4, rng, amp=0.024))
    for start in np.arange(66, length / SR, 47):
        add_clip(bed, float(start), make_clock_detail(4.2, rng, amp=0.035))

    target += bed * fade_curve(length, 1.8, 2.8)[:, None]


def render_cue(target: np.ndarray, cue: Cue, assets: LocalAssets, rng: np.random.Generator) -> None:
    if cue.role == "ambience":
        return

    if cue.label in {"Elegant title-card sting", "Elegant chapter transition"}:
        impact_amp = 1.1 if cue.label == "Elegant title-card sting" else 1.18
        add_clip(target, cue.start - 3.4, make_story_tension_lift(3.75, rng, amp=0.24))
        add_clip(target, cue.start - 2.15, make_asset_swell(2.5, assets, rng, amp=0.62))
        add_clip(target, cue.start - 1.32, make_asset_whoosh(1.52, assets, rng, amp=1.34, reverse=True))
        add_clip(target, cue.start, make_impact(2.2, rng, amp=impact_amp))
        add_clip(target, cue.start + 0.18, make_room_slap(2.6, rng, amp=0.32))
        add_clip(target, cue.start + 0.31, make_impact(1.8, rng, amp=0.58))
        add_clip(target, cue.start + 0.12, make_practical_impact_texture(1.6, rng, amp=0.14))
        add_clip(target, cue.start + 0.1, make_shimmer(2.7, rng, amp=0.12))
        add_clip(target, cue.start + 0.22, make_debris_scatter(1.8, rng, amp=0.18))
        return

    if cue.label == "Close phone and keyboard Foley":
        add_clip(target, cue.start - 0.08, make_keyboard(cue.duration, rng, amp=0.45))
        add_clip(target, cue.start - 0.02, make_close_desk_knock(0.42, rng, amp=0.08))
        add_clip(target, cue.start + 0.05, make_clock_detail(1.35, rng, amp=0.052))
        add_clip(target, cue.start + 0.58, make_debris_scatter(0.85, rng, amp=0.055))
        return

    if cue.label == "Close folder and paper Foley":
        add_clip(target, cue.start - 0.06, make_asset_whoosh(0.42, assets, rng, amp=0.18, reverse=True))
        add_clip(target, cue.start - 0.03, make_paper(cue.duration, rng, amp=0.58))
        add_clip(target, cue.start + 0.05, make_impact(0.62, rng, amp=0.18))
        add_clip(target, cue.start + 0.22, make_debris_scatter(1.0, rng, amp=0.08))
        return

    if cue.label == "Investigative office texture":
        add_clip(target, cue.start - 0.05, make_keyboard(cue.duration, rng, amp=0.18))
        add_clip(target, cue.start + 0.14, make_paper(min(1.25, cue.duration), rng, amp=0.16))
        add_clip(target, cue.start + 0.38, make_close_desk_knock(0.46, rng, amp=0.075))
        add_clip(target, cue.start, make_room_slap(cue.duration, rng, amp=0.055))
        return

    if cue.label == "Story-world texture accent":
        add_clip(target, cue.start - 0.35, make_story_tension_lift(1.4, rng, amp=0.08))
        add_clip(target, cue.start, make_debris_scatter(cue.duration, rng, amp=0.12))
        add_clip(target, cue.start + 0.05, make_close_desk_knock(0.5, rng, amp=0.085))
        add_clip(target, cue.start + 0.12, make_room_slap(1.5, rng, amp=0.065))
        return

    if cue.label == "Scene pressure lift":
        add_clip(target, cue.start - 0.4, make_story_tension_lift(cue.duration + 0.6, rng, amp=0.18))
        add_clip(target, cue.start + 0.82, make_asset_whoosh(0.9, assets, rng, amp=0.26, reverse=True))
        add_clip(target, cue.start + 1.02, make_cloth_shift(1.25, rng, amp=0.09))
        add_clip(target, cue.start + 1.55, make_close_desk_knock(0.55, rng, amp=0.09))
        add_clip(target, cue.start + 1.58, make_room_slap(1.7, rng, amp=0.08))
        return

    if cue.label in {
        "Political thriller reveal hit",
        "Institutional power hit",
        "Private leverage hit",
        "Name-card reveal hit",
    }:
        is_name = cue.label == "Name-card reveal hit"
        is_private = cue.label == "Private leverage hit"
        lift_amp = 0.24 if is_private else 0.3
        impact_amp = 1.18 if is_private else 1.34
        add_clip(target, cue.start - 4.1, make_story_tension_lift(4.4, rng, amp=lift_amp))
        add_clip(target, cue.start - 2.35, make_asset_swell(3.15, assets, rng, amp=0.84 if is_private else 0.94))
        add_clip(target, cue.start - 1.05, make_asset_whoosh(1.42, assets, rng, amp=1.28 if is_private else 1.48, reverse=True))
        add_clip(target, cue.start - 0.12, make_card_snap(0.9, rng, amp=0.22 if is_name else 0.13))
        add_clip(target, cue.start - 0.08, make_close_desk_knock(0.48, rng, amp=0.12))
        add_clip(target, cue.start + 0.02, make_metal_latch(1.15, rng, amp=0.13 if cue.label == "Institutional power hit" else 0.08))
        add_clip(target, cue.start, make_impact(cue.duration, rng, amp=impact_amp))
        add_clip(target, cue.start + 0.16, make_practical_impact_texture(1.6, rng, amp=0.2 if is_name else 0.15))
        add_clip(target, cue.start + 0.2, make_room_slap(2.7, rng, amp=0.33))
        add_clip(target, cue.start + 0.34, make_impact(1.85, rng, amp=0.58 if is_private else 0.66))
        add_clip(target, cue.start + 0.18, make_shimmer(2.4, rng, amp=0.08 if is_private else 0.11))
        add_clip(target, cue.start + 0.28, make_debris_scatter(1.9, rng, amp=0.18))
        return

    if cue.label in {"Suspense story-turn hit", "Choice rupture hit", "Truth pressure hit"}:
        is_choice = cue.label == "Choice rupture hit"
        is_truth = cue.label == "Truth pressure hit"
        add_clip(target, cue.start - 3.5, make_story_tension_lift(3.8, rng, amp=0.2 if is_truth else 0.24))
        add_clip(target, cue.start - 1.9, make_asset_swell(3.0, assets, rng, amp=0.72 if is_truth else 0.82))
        add_clip(target, cue.start - 0.72, make_asset_whoosh(0.98, assets, rng, amp=1.0 if is_truth else 1.1, reverse=True))
        add_clip(target, cue.start - 0.1, make_cloth_shift(1.25, rng, amp=0.11))
        add_clip(target, cue.start - 0.02, make_card_snap(0.62, rng, amp=0.15 if is_choice else 0.1))
        add_clip(target, cue.start, make_impact(cue.duration, rng, amp=1.08 if is_truth else 1.18))
        add_clip(target, cue.start + 0.12, make_practical_impact_texture(1.4, rng, amp=0.14))
        add_clip(target, cue.start + 0.18, make_room_slap(2.2, rng, amp=0.24))
        add_clip(target, cue.start + 0.3, make_impact(1.65, rng, amp=0.48 if is_truth else 0.56))
        add_clip(target, cue.start + 0.25, make_debris_scatter(1.45, rng, amp=0.14))
        return

    add_clip(target, cue.start - 2.6, make_story_tension_lift(3.0, rng, amp=0.18))
    add_clip(target, cue.start - 1.22, make_asset_whoosh(1.36, assets, rng, amp=1.16, reverse=True))
    add_clip(target, cue.start - 0.66, make_asset_swell(2.16, assets, rng, amp=0.64))
    add_clip(target, cue.start, make_impact(cue.duration, rng, amp=1.14))
    add_clip(target, cue.start + 0.2, make_room_slap(2.0, rng, amp=0.24))
    add_clip(target, cue.start + 0.31, make_impact(1.55, rng, amp=0.5))
    add_clip(target, cue.start + 0.22, make_debris_scatter(1.25, rng, amp=0.12))


def finish_bed_stem(stem: np.ndarray) -> np.ndarray:
    stem = add_studio_tail(stem, 0.16)
    stem = soft_limit(stem, 1.08)
    peak = float(np.max(np.abs(stem)) + 1e-12)
    if peak > 0.38:
        stem *= 0.38 / peak
    return stem.astype(np.float32)


def finish_event_stem(stem: np.ndarray) -> np.ndarray:
    stem = add_studio_tail(stem, 0.46)
    stem = stereo_widen(stem, 1.32)
    stem = soft_limit(stem, 1.06)
    peak = float(np.max(np.abs(stem)) + 1e-12)
    if peak > 0.68:
        stem *= 0.68 / peak
    return stem.astype(np.float32)


def finish_combined_stem(stem: np.ndarray) -> np.ndarray:
    stem = soft_limit(stem, 1.08)
    peak = float(np.max(np.abs(stem)) + 1e-12)
    if peak > 0.72:
        stem *= 0.72 / peak
    return stem.astype(np.float32)


def build_sfx(
    narration: np.ndarray,
    duration: float,
    transcript_path: Path,
    downloads_dir: Path,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[Cue]]:
    del narration
    rng = np.random.default_rng(20260709)
    assets = load_local_assets(downloads_dir)
    bed = np.zeros((round(duration * SR), CHANNELS), dtype=np.float32)
    events = np.zeros_like(bed)
    add_room_bed(bed, assets, rng)

    cues = build_cues(load_transcript(transcript_path), duration)
    for cue in cues:
        render_cue(events, cue, assets, rng)

    bed = finish_bed_stem(bed)
    events = finish_event_stem(events)
    return finish_combined_stem(bed + events), bed, events, cues


def default_wav_output(mp3_output: Path) -> Path:
    return mp3_output.with_suffix(".wav")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_DOWNLOADS / "full_story.mp3")
    parser.add_argument("--duration", type=float, default=300.0)
    parser.add_argument("--transcript", type=Path, default=DEFAULT_TRANSCRIPT)
    parser.add_argument("--downloads-dir", type=Path, default=DEFAULT_DOWNLOADS)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_DOWNLOADS / "full_story_opening_CINEMATIC_SFX_V14_STUDIO_FOLEY_5min.mp3",
    )
    parser.add_argument("--wav-output", type=Path)
    parser.add_argument(
        "--stem",
        type=Path,
        default=DEFAULT_DOWNLOADS / "full_story_opening_CINEMATIC_SFX_V14_STUDIO_FOLEY_stem.wav",
    )
    parser.add_argument(
        "--bed-stem",
        type=Path,
        default=DEFAULT_DOWNLOADS / "full_story_opening_CINEMATIC_SFX_V14_STUDIO_FOLEY_bed.wav",
    )
    parser.add_argument(
        "--event-stem",
        type=Path,
        default=DEFAULT_DOWNLOADS / "full_story_opening_CINEMATIC_SFX_V14_STUDIO_FOLEY_events.wav",
    )
    parser.add_argument(
        "--cues",
        type=Path,
        default=DEFAULT_DOWNLOADS / "full_story_opening_CINEMATIC_SFX_V14_STUDIO_FOLEY_cues.json",
    )
    args = parser.parse_args()

    narration = decode_audio(args.input, args.duration)
    sfx, bed, events, cues = build_sfx(narration, args.duration, args.transcript, args.downloads_dir)
    write_wav(args.stem, sfx)
    write_wav(args.bed_stem, bed)
    write_wav(args.event_stem, events)
    args.cues.write_text(json.dumps([asdict(cue) for cue in cues], indent=2), encoding="utf-8")
    render_mp3_mix(args.input, args.bed_stem, args.event_stem, args.output, args.duration)
    render_wav_mix(
        args.input,
        args.bed_stem,
        args.event_stem,
        args.wav_output or default_wav_output(args.output),
        args.duration,
    )
    print(f"Wrote {args.output}")
    print(f"Wrote {args.wav_output or default_wav_output(args.output)}")
    print(f"Wrote {args.stem}")
    print(f"Wrote {args.bed_stem}")
    print(f"Wrote {args.event_stem}")
    print(f"Wrote {args.cues}")


if __name__ == "__main__":
    main()
