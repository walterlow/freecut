import type { ProjectResolution } from '@/types/project';
import type { MediaMetadata } from '@/types/storage';
import { formatFpsValue, resolveAutoMatchProjectFps } from '@/features/editor/deps/projects';

export interface ProjectMediaMatchSuggestion {
  width: number;
  height: number;
  fps: number;
  sourceFpsLabel: string;
  matchedFpsLabel: string;
  fpsWasRounded: boolean;
  sizeDiffers: boolean;
  fpsDiffers: boolean;
  hasChanges: boolean;
}

function normalizeDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function isProjectMatchableVideo(media: MediaMetadata): boolean {
  return media.mimeType.startsWith('video/')
    && Number.isFinite(media.width)
    && media.width > 0
    && Number.isFinite(media.height)
    && media.height > 0
    && Number.isFinite(media.fps)
    && media.fps > 0;
}

export function getProjectMediaMatchSuggestion(
  project: ProjectResolution,
  media: MediaMetadata
): ProjectMediaMatchSuggestion {
  const width = normalizeDimension(media.width);
  const height = normalizeDimension(media.height);
  const fpsMatch = resolveAutoMatchProjectFps(media.fps);
  const fps = fpsMatch.fps;

  const sizeDiffers = width > 0
    && height > 0
    && (project.width !== width || project.height !== height);
  const fpsDiffers = project.fps !== fps;

  return {
    width,
    height,
    fps,
    sourceFpsLabel: formatFpsValue(media.fps),
    matchedFpsLabel: formatFpsValue(fps),
    fpsWasRounded: !fpsMatch.exact,
    sizeDiffers,
    fpsDiffers,
    hasChanges: sizeDiffers || fpsDiffers,
  };
}
