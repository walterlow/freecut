/**
 * Frame sampling strategies for thumbnail generation.
 *
 * Determines which frames to render as thumbnails for a given
 * composition duration. Strategies are ranked by quality:
 * scene-boundary > content-aware > even distribution.
 */

import type { SceneCut } from '@/infrastructure/analysis';

interface ClipBoundary {
  from: number;
  to: number;
}

/**
 * Scene-boundary sampling: place samples at midpoint of each scene segment.
 * Best quality — requires optical flow scene detection results.
 */
export function sampleBySceneBoundaries(
  sceneCuts: SceneCut[],
  totalFrames: number,
  maxSamples: number,
): number[] {
  const boundaries = [0, ...sceneCuts.map((sc) => sc.frame), totalFrames];
  const segments: Array<[number, number]> = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    segments.push([start, end]);
  }

  let selectedSegments = segments;
  if (segments.length > maxSamples) {
    selectedSegments = [];
    for (let i = 0; i < maxSamples; i++) {
      const idx = Math.floor((i / maxSamples) * segments.length);
      const seg = segments[idx];
      if (seg) selectedSegments.push(seg);
    }
  }

  return selectedSegments.map(([start, end]) =>
    Math.floor((start + end) / 2)
  );
}

/**
 * Content-aware sampling: place samples at clip boundaries + fill gaps.
 * Medium quality — uses clip position data from timeline.
 */
export function sampleByClipBoundaries(
  clips: ClipBoundary[],
  totalFrames: number,
  maxSamples: number,
): number[] {
  if (clips.length === 0) {
    return sampleEvenDistribution(totalFrames, maxSamples);
  }

  const frames = new Set<number>();

  for (const clip of clips) {
    frames.add(clip.from);
  }

  const budget = maxSamples - frames.size;
  if (budget > 0) {
    const step = totalFrames / (budget + 1);
    for (let i = 1; i <= budget; i++) {
      frames.add(Math.floor(i * step));
    }
  }

  return Array.from(frames)
    .filter((f) => f >= 0 && f < totalFrames)
    .sort((a, b) => a - b)
    .slice(0, maxSamples);
}

/**
 * Even distribution sampling: evenly spaced frames.
 * Fallback — no scene or clip data needed.
 */
export function sampleEvenDistribution(
  totalFrames: number,
  maxSamples: number,
): number[] {
  if (totalFrames <= 0 || maxSamples <= 0) return [];
  if (maxSamples === 1) return [Math.floor(totalFrames / 2)];

  const frames: number[] = [];
  const step = totalFrames / maxSamples;
  for (let i = 0; i < maxSamples; i++) {
    frames.push(Math.floor(i * step + step / 2));
  }
  return frames;
}
