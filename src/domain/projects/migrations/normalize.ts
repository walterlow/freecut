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
import { DEFAULT_TRACK_HEIGHT, DEFAULT_FPS } from '@/domain/timeline/defaults';
import {
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
  clampAudioEqCutSlopeDbPerOct,
  clampAudioEqFrequencyHz,
  clampAudioEqGainDb,
  clampAudioEqQ,
  normalizeAudioEqSettings,
} from '@/shared/utils/audio-eq';
import {
  clampAudioPitchCents,
  clampAudioPitchSemitones,
} from '@/shared/utils/audio-pitch';

/**
 * Normalize a track to ensure all fields have valid values.
 */
function normalizeTrack(
  track: ProjectTimeline['tracks'][number],
  index: number
): ProjectTimeline['tracks'][number] {
  const normalizedVolume = track.volume;
  const normalizedKind = track.kind === 'video' || track.kind === 'audio'
    ? track.kind
    : undefined;
  return {
    ...track,
    // Always use current default — no user-facing track resize exists yet
    height: DEFAULT_TRACK_HEIGHT,
    // Ensure boolean fields have defaults
    locked: track.locked ?? false,
    syncLock: track.syncLock ?? true,
    visible: track.visible ?? true,
    muted: track.muted ?? false,
    solo: track.solo ?? false,
    volume: normalizedVolume === undefined
      ? 0
      : Math.max(-60, Math.min(12, normalizedVolume)),
    audioEq: normalizeAudioEqSettings(track.audioEq),
    kind: normalizedKind,
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
    sourceFps?: number;
  };

  // Keep timeline and source coordinates aligned to whole frames.
  normalized.from = Math.max(0, Math.round(normalized.from ?? 0));
  normalized.durationInFrames = Math.max(1, Math.round(normalized.durationInFrames ?? 1));
  if (maybeFrameFields.trimStart !== undefined) maybeFrameFields.trimStart = Math.max(0, Math.round(maybeFrameFields.trimStart));
  if (maybeFrameFields.trimEnd !== undefined) maybeFrameFields.trimEnd = Math.max(0, Math.round(maybeFrameFields.trimEnd));
  if (maybeFrameFields.sourceStart !== undefined) maybeFrameFields.sourceStart = Math.max(0, Math.round(maybeFrameFields.sourceStart));
  if (maybeFrameFields.sourceEnd !== undefined) maybeFrameFields.sourceEnd = Math.max(0, Math.round(maybeFrameFields.sourceEnd));
  if (maybeFrameFields.sourceDuration !== undefined) maybeFrameFields.sourceDuration = Math.max(0, Math.round(maybeFrameFields.sourceDuration));
  if (maybeFrameFields.sourceFps !== undefined) {
    maybeFrameFields.sourceFps = Number.isFinite(maybeFrameFields.sourceFps) && maybeFrameFields.sourceFps > 0
      ? Math.round(maybeFrameFields.sourceFps * 1000) / 1000
      : undefined;
  }

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
  if (normalized.audioPitchSemitones !== undefined) {
    normalized.audioPitchSemitones = clampAudioPitchSemitones(normalized.audioPitchSemitones);
  }
  if (normalized.audioPitchCents !== undefined) {
    normalized.audioPitchCents = clampAudioPitchCents(normalized.audioPitchCents);
  }
  if (normalized.audioEqOutputGainDb !== undefined) {
    normalized.audioEqOutputGainDb = clampAudioEqGainDb(normalized.audioEqOutputGainDb);
  }
  if (normalized.audioEqBand1Enabled !== undefined) {
    normalized.audioEqBand1Enabled = !!normalized.audioEqBand1Enabled;
  }
  if (normalized.audioEqBand1FrequencyHz !== undefined) {
    normalized.audioEqBand1FrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqBand1FrequencyHz,
      AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    );
  }
  if (normalized.audioEqBand1GainDb !== undefined) {
    normalized.audioEqBand1GainDb = clampAudioEqGainDb(normalized.audioEqBand1GainDb);
  }
  if (normalized.audioEqBand1Q !== undefined) {
    normalized.audioEqBand1Q = clampAudioEqQ(normalized.audioEqBand1Q);
  }
  if (normalized.audioEqBand1SlopeDbPerOct !== undefined) {
    normalized.audioEqBand1SlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(normalized.audioEqBand1SlopeDbPerOct);
  }
  if (normalized.audioEqLowCutEnabled !== undefined) {
    normalized.audioEqLowCutEnabled = !!normalized.audioEqLowCutEnabled;
  }
  if (normalized.audioEqLowCutFrequencyHz !== undefined) {
    normalized.audioEqLowCutFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqLowCutFrequencyHz,
      AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    );
  }
  if (normalized.audioEqLowCutSlopeDbPerOct !== undefined) {
    normalized.audioEqLowCutSlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(normalized.audioEqLowCutSlopeDbPerOct);
  }
  if (normalized.audioEqLowEnabled !== undefined) {
    normalized.audioEqLowEnabled = !!normalized.audioEqLowEnabled;
  }
  if (normalized.audioEqLowGainDb !== undefined) {
    normalized.audioEqLowGainDb = clampAudioEqGainDb(normalized.audioEqLowGainDb);
  }
  if (normalized.audioEqLowFrequencyHz !== undefined) {
    normalized.audioEqLowFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqLowFrequencyHz,
      AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_FREQUENCY_HZ,
    );
  }
  if (normalized.audioEqLowQ !== undefined) {
    normalized.audioEqLowQ = clampAudioEqQ(normalized.audioEqLowQ);
  }
  if (normalized.audioEqLowMidEnabled !== undefined) {
    normalized.audioEqLowMidEnabled = !!normalized.audioEqLowMidEnabled;
  }
  if (normalized.audioEqLowMidGainDb !== undefined) {
    normalized.audioEqLowMidGainDb = clampAudioEqGainDb(normalized.audioEqLowMidGainDb);
  }
  if (normalized.audioEqLowMidFrequencyHz !== undefined) {
    normalized.audioEqLowMidFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqLowMidFrequencyHz,
      AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
    );
  }
  if (normalized.audioEqLowMidQ !== undefined) {
    normalized.audioEqLowMidQ = clampAudioEqQ(normalized.audioEqLowMidQ, AUDIO_EQ_LOW_MID_Q);
  }
  if (normalized.audioEqMidGainDb !== undefined) {
    normalized.audioEqMidGainDb = clampAudioEqGainDb(normalized.audioEqMidGainDb);
  }
  if (normalized.audioEqHighMidEnabled !== undefined) {
    normalized.audioEqHighMidEnabled = !!normalized.audioEqHighMidEnabled;
  }
  if (normalized.audioEqHighMidGainDb !== undefined) {
    normalized.audioEqHighMidGainDb = clampAudioEqGainDb(normalized.audioEqHighMidGainDb);
  }
  if (normalized.audioEqHighMidFrequencyHz !== undefined) {
    normalized.audioEqHighMidFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqHighMidFrequencyHz,
      AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
    );
  }
  if (normalized.audioEqHighMidQ !== undefined) {
    normalized.audioEqHighMidQ = clampAudioEqQ(normalized.audioEqHighMidQ, AUDIO_EQ_HIGH_MID_Q);
  }
  if (normalized.audioEqHighEnabled !== undefined) {
    normalized.audioEqHighEnabled = !!normalized.audioEqHighEnabled;
  }
  if (normalized.audioEqHighGainDb !== undefined) {
    normalized.audioEqHighGainDb = clampAudioEqGainDb(normalized.audioEqHighGainDb);
  }
  if (normalized.audioEqHighFrequencyHz !== undefined) {
    normalized.audioEqHighFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqHighFrequencyHz,
      AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_FREQUENCY_HZ,
    );
  }
  if (normalized.audioEqHighQ !== undefined) {
    normalized.audioEqHighQ = clampAudioEqQ(normalized.audioEqHighQ);
  }
  if (normalized.audioEqBand6Enabled !== undefined) {
    normalized.audioEqBand6Enabled = !!normalized.audioEqBand6Enabled;
  }
  if (normalized.audioEqBand6FrequencyHz !== undefined) {
    normalized.audioEqBand6FrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqBand6FrequencyHz,
      AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    );
  }
  if (normalized.audioEqBand6GainDb !== undefined) {
    normalized.audioEqBand6GainDb = clampAudioEqGainDb(normalized.audioEqBand6GainDb);
  }
  if (normalized.audioEqBand6Q !== undefined) {
    normalized.audioEqBand6Q = clampAudioEqQ(normalized.audioEqBand6Q);
  }
  if (normalized.audioEqBand6SlopeDbPerOct !== undefined) {
    normalized.audioEqBand6SlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(normalized.audioEqBand6SlopeDbPerOct);
  }
  if (normalized.audioEqHighCutEnabled !== undefined) {
    normalized.audioEqHighCutEnabled = !!normalized.audioEqHighCutEnabled;
  }
  if (normalized.audioEqHighCutFrequencyHz !== undefined) {
    normalized.audioEqHighCutFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqHighCutFrequencyHz,
      AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    );
  }
  if (normalized.audioEqHighCutSlopeDbPerOct !== undefined) {
    normalized.audioEqHighCutSlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(normalized.audioEqHighCutSlopeDbPerOct);
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
    timing: transition.timing ?? 'linear',
  };
}

function flattenTrackGroups(
  tracks: ProjectTimeline['tracks']
): ProjectTimeline['tracks'] {
  return tracks
    .filter((track) => !track.isGroup)
    .map((track) => ({
      ...track,
      parentTrackId: undefined,
      isGroup: undefined,
      isCollapsed: undefined,
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * Build a set of item ID pairs that are linked by a transition.
 * Overlaps between transition-linked clips are intentional and must not be repaired.
 */
function buildTransitionPairs(
  transitions?: NonNullable<ProjectTimeline['transitions']>
): Set<string> {
  const pairs = new Set<string>();
  if (!transitions) return pairs;
  for (const t of transitions) {
    // Store both directions for O(1) lookup
    pairs.add(`${t.leftClipId}:${t.rightClipId}`);
    pairs.add(`${t.rightClipId}:${t.leftClipId}`);
  }
  return pairs;
}

/**
 * Detect and repair overlapping items on the same track.
 * Pushes later-starting items forward to eliminate overlaps.
 * Transition-linked overlaps are intentional and left untouched.
 */
function repairOverlappingItems(
  items: ProjectTimeline['items'],
  transitions?: NonNullable<ProjectTimeline['transitions']>,
): ProjectTimeline['items'] {
  const transitionPairs = buildTransitionPairs(transitions);

  // Group items by track, sorted by start frame
  const byTrack = new Map<string, Array<{ index: number; item: ProjectTimeline['items'][number] }>>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    let group = byTrack.get(item.trackId);
    if (!group) {
      group = [];
      byTrack.set(item.trackId, group);
    }
    group.push({ index: i, item });
  }

  const repaired = [...items];

  for (const [, group] of byTrack) {
    group.sort((a, b) => a.item.from - b.item.from);

    for (let i = 0; i < group.length; i++) {
      const current = group[i]!;
      const currentEnd = current.item.from + current.item.durationInFrames;

      for (let j = i + 1; j < group.length; j++) {
        const next = group[j]!;
        if (next.item.from >= currentEnd) break; // No overlap

        // Skip transition-linked overlaps — they're intentional
        const pairKey = `${current.item.id}:${next.item.id}`;
        if (transitionPairs.has(pairKey)) continue;

        // Push the later item to start right after the current one
        const repairedItem = { ...next.item, from: currentEnd };
        repaired[next.index] = repairedItem;
        next.item = repairedItem;
      }
    }
  }

  return repaired;
}

/**
 * Normalize a timeline to ensure all data conforms to current defaults.
 */
function normalizeTimeline(timeline: ProjectTimeline): ProjectTimeline {
  const normalizedTracks = flattenTrackGroups(
    timeline.tracks.map((track, index) => normalizeTrack(track, index))
  );

  const normalizedItems = timeline.items.map(normalizeItem);
  const normalizedTransitions = timeline.transitions?.map(normalizeTransition);

  return {
    ...timeline,
    // Normalize tracks
    tracks: normalizedTracks,
    busAudioEq: normalizeAudioEqSettings(timeline.busAudioEq),
    // Normalize items and repair overlaps
    items: repairOverlappingItems(normalizedItems, normalizedTransitions),
    // Normalize transitions if present
    transitions: normalizedTransitions,
    // Normalize sub-composition tracks and items
    compositions: timeline.compositions?.map((comp) => {
      const compItems = comp.items.map(normalizeItem);
      const compTransitions = comp.transitions?.map(normalizeTransition);
      return {
        ...comp,
        tracks: flattenTrackGroups(comp.tracks.map((track, index) => normalizeTrack(track, index))),
        busAudioEq: normalizeAudioEqSettings(comp.busAudioEq),
        items: repairOverlappingItems(compItems, compTransitions),
        transitions: compTransitions,
      };
    }),
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
