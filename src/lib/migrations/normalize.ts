/**
 * Normalization Utilities
 *
 * Applied on every project load to ensure data conforms to current defaults.
 * Unlike migrations, normalization is not versioned - it always applies
 * the current expected defaults and constraints.
 *
 * Use normalization for:
 * - Applying default values for missing optional fields
 * - Clamping values to valid ranges
 * - Ensuring type consistency
 *
 * Use migrations for:
 * - Breaking schema changes
 * - Renaming fields
 * - Restructuring data
 */

import type { Project, ProjectTimeline } from '@/types/project';
import {
  DEFAULT_TRACK_HEIGHT,
  MIN_TRACK_HEIGHT,
  MAX_TRACK_HEIGHT,
  DEFAULT_FPS,
} from '@/features/timeline/constants';

/**
 * Normalize a track to ensure all fields have valid values.
 */
function normalizeTrack(
  track: ProjectTimeline['tracks'][number],
  index: number
): ProjectTimeline['tracks'][number] {
  return {
    ...track,
    // Ensure height is within valid bounds
    height: Math.max(
      MIN_TRACK_HEIGHT,
      Math.min(MAX_TRACK_HEIGHT, track.height ?? DEFAULT_TRACK_HEIGHT)
    ),
    // Ensure boolean fields have defaults
    locked: track.locked ?? false,
    visible: track.visible ?? true,
    muted: track.muted ?? false,
    solo: track.solo ?? false,
    // Ensure order is set (fallback to index if missing)
    order: track.order ?? index,
  };
}

/**
 * Normalize a timeline item to ensure all fields have valid values.
 */
function normalizeItem(
  item: ProjectTimeline['items'][number]
): ProjectTimeline['items'][number] {
  const normalized = { ...item };
  const maybeFrameFields = normalized as typeof normalized & {
    trimStart?: number;
    trimEnd?: number;
    sourceStart?: number;
    sourceEnd?: number;
    sourceDuration?: number;
  };

  // Keep timeline and source coordinates aligned to whole frames.
  normalized.from = Math.max(0, Math.round(normalized.from ?? 0));
  normalized.durationInFrames = Math.max(1, Math.round(normalized.durationInFrames ?? 1));
  if (maybeFrameFields.trimStart !== undefined) maybeFrameFields.trimStart = Math.max(0, Math.round(maybeFrameFields.trimStart));
  if (maybeFrameFields.trimEnd !== undefined) maybeFrameFields.trimEnd = Math.max(0, Math.round(maybeFrameFields.trimEnd));
  if (maybeFrameFields.sourceStart !== undefined) maybeFrameFields.sourceStart = Math.max(0, Math.round(maybeFrameFields.sourceStart));
  if (maybeFrameFields.sourceEnd !== undefined) maybeFrameFields.sourceEnd = Math.max(0, Math.round(maybeFrameFields.sourceEnd));
  if (maybeFrameFields.sourceDuration !== undefined) maybeFrameFields.sourceDuration = Math.max(0, Math.round(maybeFrameFields.sourceDuration));

  // Ensure speed is valid (default 1.0, range 0.1-10.0)
  if (normalized.speed !== undefined) {
    normalized.speed = Math.max(0.1, Math.min(10.0, normalized.speed));
  }

  // Ensure volume is valid (default 0dB, range -60 to +12)
  if (normalized.volume !== undefined) {
    normalized.volume = Math.max(-60, Math.min(12, normalized.volume));
  }

  // Ensure fade values are non-negative
  if (normalized.fadeIn !== undefined) {
    normalized.fadeIn = Math.max(0, normalized.fadeIn);
  }
  if (normalized.fadeOut !== undefined) {
    normalized.fadeOut = Math.max(0, normalized.fadeOut);
  }
  if (normalized.audioFadeIn !== undefined) {
    normalized.audioFadeIn = Math.max(0, normalized.audioFadeIn);
  }
  if (normalized.audioFadeOut !== undefined) {
    normalized.audioFadeOut = Math.max(0, normalized.audioFadeOut);
  }

  // Normalize transform if present
  if (normalized.transform) {
    normalized.transform = {
      ...normalized.transform,
      // Ensure rotation is normalized to 0-360
      rotation: normalized.transform.rotation !== undefined
        ? ((normalized.transform.rotation % 360) + 360) % 360
        : undefined,
      // Ensure opacity is 0-1
      opacity: normalized.transform.opacity !== undefined
        ? Math.max(0, Math.min(1, normalized.transform.opacity))
        : undefined,
      // Ensure cornerRadius is non-negative
      cornerRadius: normalized.transform.cornerRadius !== undefined
        ? Math.max(0, normalized.transform.cornerRadius)
        : undefined,
    };
  }

  return normalized;
}

/**
 * Normalize a transition to ensure all fields have valid values.
 */
function normalizeTransition(
  transition: NonNullable<ProjectTimeline['transitions']>[number]
): NonNullable<ProjectTimeline['transitions']>[number] {
  return {
    ...transition,
    // Ensure duration is at least 1 frame
    durationInFrames: Math.max(1, Math.round(transition.durationInFrames)),
  };
}

/**
 * Normalize a timeline to ensure all data conforms to current defaults.
 */
function normalizeTimeline(timeline: ProjectTimeline): ProjectTimeline {
  return {
    ...timeline,
    // Normalize tracks
    tracks: timeline.tracks.map((track, index) => normalizeTrack(track, index)),
    // Normalize items
    items: timeline.items.map(normalizeItem),
    // Normalize transitions if present
    transitions: timeline.transitions?.map(normalizeTransition),
    // Ensure frame values are non-negative integers
    currentFrame: Math.max(0, Math.floor(timeline.currentFrame ?? 0)),
    // Ensure zoom is positive
    zoomLevel: Math.max(0.01, timeline.zoomLevel ?? 1),
    // Ensure scroll is non-negative
    scrollPosition: Math.max(0, timeline.scrollPosition ?? 0),
  };
}

/**
 * Normalize project metadata.
 */
function normalizeMetadata(
  metadata: Project['metadata']
): Project['metadata'] {
  return {
    ...metadata,
    // Ensure dimensions are positive
    width: Math.max(1, metadata.width),
    height: Math.max(1, metadata.height),
    // Ensure FPS is valid
    fps: Math.max(1, Math.min(120, metadata.fps ?? DEFAULT_FPS)),
  };
}

/**
 * Normalize a project to ensure all data conforms to current defaults.
 * This is applied after migrations on every load.
 */
export function normalizeProject(project: Project): Project {
  const normalized: Project = {
    ...project,
    // Normalize metadata
    metadata: normalizeMetadata(project.metadata),
  };

  // Normalize timeline if present
  if (normalized.timeline) {
    normalized.timeline = normalizeTimeline(normalized.timeline);
  }

  return normalized;
}

/**
 * Check if normalization changed the project.
 * Uses JSON comparison for simplicity (works for our data types).
 */
export function didNormalizationChange(
  original: Project,
  normalized: Project
): boolean {
  return JSON.stringify(original) !== JSON.stringify(normalized);
}
