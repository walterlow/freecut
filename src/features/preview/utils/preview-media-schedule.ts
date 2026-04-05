import type { TimelineTrack } from '@/types/timeline';
import type { VideoSourceSpan } from './preview-constants';
import { getDirectionalScrubStartIndex } from './preview-constants';

export interface PreviewMediaScheduleEntry {
  mediaId: string;
  from: number;
  durationInFrames: number;
  endFrame: number;
  centerFrame: number;
  cost: number;
}

export interface PreviewMediaScheduleTrack {
  entries: PreviewMediaScheduleEntry[];
}

export interface PreviewMediaScheduleIndex {
  tracks: PreviewMediaScheduleTrack[];
  entries: PreviewMediaScheduleEntry[];
}

export interface PreviewMediaWindowPriorityInput {
  anchorFrame: number;
  costPenaltyFrames: number;
  scrubDirection?: -1 | 0 | 1;
  scrubDirectionBiasFrames?: number;
}

export interface PreviewMediaWindowPriority {
  score: number;
  directionPenaltyApplied: boolean;
}

export interface CollectResolveMediaPrioritiesInput {
  index: PreviewMediaScheduleIndex;
  unresolvedMediaIds: Set<string>;
  anchorFrame: number;
  activeWindowStartFrame: number;
  activeWindowEndFrame: number;
  costPenaltyFrames: number;
}

export interface CollectResolveMediaPrioritiesResult {
  priorityByMediaId: Map<string, number>;
  maxActiveWindowCost: number;
}

export interface PreviewMediaScanCursor {
  trackIndex: number;
  itemIndex: number;
}

export interface ScanPreloadMediaPrioritiesInput {
  index: PreviewMediaScheduleIndex;
  unresolvedMediaIds: Set<string>;
  anchorFrame: number;
  preloadStartFrame: number;
  preloadEndFrame: number;
  scrubDirection: -1 | 0 | 1;
  now: number;
  getResolveRetryAt: (mediaId: string) => number;
  costPenaltyFrames: number;
  scrubDirectionBiasFrames: number;
  scanCursor: PreviewMediaScanCursor;
  scanStartTimeMs: number;
  scanTimeBudgetMs: number;
  readTimeMs: () => number;
  useDirectionalScan: boolean;
}

export interface ScanPreloadMediaPrioritiesResult {
  mediaToPreloadScores: Map<string, number>;
  maxActiveWindowCost: number;
  directionPenaltyCount: number;
  reachedScanTimeBudget: boolean;
  nextCursor: PreviewMediaScanCursor;
}

export interface SourceWarmCandidateWindow {
  spans: VideoSourceSpan[];
  anchorFrame: number;
  windowFrames: number;
  baseScore: number;
}

function isMediaBackedItem(
  item: TimelineTrack['items'][number],
): item is TimelineTrack['items'][number] & { mediaId: string } {
  return (
    typeof item.mediaId === 'string'
    && item.mediaId.length > 0
    && (item.type === 'video' || item.type === 'audio' || item.type === 'image')
  );
}

function isEntryInWindow(
  entry: PreviewMediaScheduleEntry,
  startFrame: number,
  endFrame: number,
): boolean {
  return entry.from <= endFrame && entry.endFrame >= startFrame;
}

export function getPreviewMediaWindowPriority(
  entry: PreviewMediaScheduleEntry,
  input: PreviewMediaWindowPriorityInput,
): PreviewMediaWindowPriority {
  const distanceToAnchor = input.anchorFrame < entry.from
    ? entry.from - input.anchorFrame
    : input.anchorFrame > entry.endFrame
      ? input.anchorFrame - entry.endFrame
      : 0;
  let score = distanceToAnchor + (entry.cost * input.costPenaltyFrames);
  let directionPenaltyApplied = false;

  if (
    input.scrubDirection !== undefined
    && input.scrubDirection !== 0
    && input.scrubDirectionBiasFrames !== undefined
  ) {
    const isDirectionAligned = input.scrubDirection > 0
      ? entry.centerFrame >= input.anchorFrame
      : entry.centerFrame <= input.anchorFrame;
    if (!isDirectionAligned) {
      score += input.scrubDirectionBiasFrames;
      directionPenaltyApplied = true;
    }
  }

  return { score, directionPenaltyApplied };
}

export function createPreviewMediaScheduleIndex(
  tracks: TimelineTrack[],
  mediaResolveCostById: Map<string, number>,
): PreviewMediaScheduleIndex {
  const scheduleTracks: PreviewMediaScheduleTrack[] = [];
  const entries: PreviewMediaScheduleEntry[] = [];

  for (const track of tracks) {
    const trackEntries: PreviewMediaScheduleEntry[] = [];
    for (const item of track.items) {
      if (!isMediaBackedItem(item)) continue;
      const durationInFrames = item.durationInFrames;
      const entry: PreviewMediaScheduleEntry = {
        mediaId: item.mediaId,
        from: item.from,
        durationInFrames,
        endFrame: item.from + durationInFrames,
        centerFrame: item.from + (durationInFrames * 0.5),
        cost: mediaResolveCostById.get(item.mediaId) ?? 1,
      };
      trackEntries.push(entry);
      entries.push(entry);
    }
    scheduleTracks.push({ entries: trackEntries });
  }

  return {
    tracks: scheduleTracks,
    entries,
  };
}

export function collectResolveMediaPriorities(
  input: CollectResolveMediaPrioritiesInput,
): CollectResolveMediaPrioritiesResult {
  const priorityByMediaId = new Map<string, number>();
  let maxActiveWindowCost = 0;

  for (const entry of input.index.entries) {
    if (!input.unresolvedMediaIds.has(entry.mediaId)) continue;

    const { score } = getPreviewMediaWindowPriority(entry, {
      anchorFrame: input.anchorFrame,
      costPenaltyFrames: input.costPenaltyFrames,
    });
    const previousScore = priorityByMediaId.get(entry.mediaId);
    if (previousScore === undefined || score < previousScore) {
      priorityByMediaId.set(entry.mediaId, score);
    }

    if (
      isEntryInWindow(entry, input.activeWindowStartFrame, input.activeWindowEndFrame)
      && entry.cost > maxActiveWindowCost
    ) {
      maxActiveWindowCost = entry.cost;
    }
  }

  return {
    priorityByMediaId,
    maxActiveWindowCost,
  };
}

export function scanPreloadMediaPriorities(
  input: ScanPreloadMediaPrioritiesInput,
): ScanPreloadMediaPrioritiesResult {
  const mediaToPreloadScores = new Map<string, number>();
  let maxActiveWindowCost = 0;
  let directionPenaltyCount = 0;
  let reachedScanTimeBudget = false;

  if (input.index.tracks.length === 0) {
    return {
      mediaToPreloadScores,
      maxActiveWindowCost,
      directionPenaltyCount,
      reachedScanTimeBudget,
      nextCursor: { trackIndex: 0, itemIndex: 0 },
    };
  }

  let trackIndex = ((input.scanCursor.trackIndex % input.index.tracks.length) + input.index.tracks.length)
    % input.index.tracks.length;
  let itemIndex = Math.max(0, input.scanCursor.itemIndex);

  const processEntry = (entry: PreviewMediaScheduleEntry) => {
    if (!isEntryInWindow(entry, input.preloadStartFrame, input.preloadEndFrame)) {
      return;
    }
    if (!input.unresolvedMediaIds.has(entry.mediaId)) {
      return;
    }
    if (input.getResolveRetryAt(entry.mediaId) > input.now) {
      return;
    }

    if (entry.cost > maxActiveWindowCost) {
      maxActiveWindowCost = entry.cost;
    }

    const { score, directionPenaltyApplied } = getPreviewMediaWindowPriority(entry, {
      anchorFrame: input.anchorFrame,
      costPenaltyFrames: input.costPenaltyFrames,
      scrubDirection: input.scrubDirection,
      scrubDirectionBiasFrames: input.scrubDirectionBiasFrames,
    });
    if (directionPenaltyApplied) {
      directionPenaltyCount += 1;
    }
    const previousScore = mediaToPreloadScores.get(entry.mediaId);
    if (previousScore === undefined || score < previousScore) {
      mediaToPreloadScores.set(entry.mediaId, score);
    }
  };

  const hitTimeBudget = () => {
    return (input.readTimeMs() - input.scanStartTimeMs) >= input.scanTimeBudgetMs;
  };

  if (input.useDirectionalScan) {
    for (let trackCount = 0; trackCount < input.index.tracks.length; trackCount++) {
      const currentTrackIndex = (trackIndex + trackCount) % input.index.tracks.length;
      const track = input.index.tracks[currentTrackIndex]!;
      if (track.entries.length === 0) continue;

      const step = input.scrubDirection < 0 ? -1 : 1;
      let localItemIndex = getDirectionalScrubStartIndex(
        track.entries,
        input.anchorFrame,
        input.scrubDirection,
      );

      while (localItemIndex >= 0 && localItemIndex < track.entries.length) {
        processEntry(track.entries[localItemIndex]!);

        if (hitTimeBudget()) {
          reachedScanTimeBudget = true;
          return {
            mediaToPreloadScores,
            maxActiveWindowCost,
            directionPenaltyCount,
            reachedScanTimeBudget,
            nextCursor: {
              trackIndex: currentTrackIndex,
              itemIndex: 0,
            },
          };
        }

        localItemIndex += step;
      }
    }

    return {
      mediaToPreloadScores,
      maxActiveWindowCost,
      directionPenaltyCount,
      reachedScanTimeBudget,
      nextCursor: {
        trackIndex: (trackIndex + 1) % input.index.tracks.length,
        itemIndex: 0,
      },
    };
  }

  for (let trackCount = 0; trackCount < input.index.tracks.length; trackCount++) {
    const track = input.index.tracks[trackIndex]!;
    const startItemIndex = trackCount === 0 ? itemIndex : 0;

    for (let localItemIndex = startItemIndex; localItemIndex < track.entries.length; localItemIndex++) {
      processEntry(track.entries[localItemIndex]!);

      if (hitTimeBudget()) {
        reachedScanTimeBudget = true;
        let nextTrackIndex = trackIndex;
        let nextItemIndex = localItemIndex + 1;
        if (nextItemIndex >= track.entries.length) {
          nextTrackIndex = (trackIndex + 1) % input.index.tracks.length;
          nextItemIndex = 0;
        }

        return {
          mediaToPreloadScores,
          maxActiveWindowCost,
          directionPenaltyCount,
          reachedScanTimeBudget,
          nextCursor: {
            trackIndex: nextTrackIndex,
            itemIndex: nextItemIndex,
          },
        };
      }
    }

    trackIndex = (trackIndex + 1) % input.index.tracks.length;
    itemIndex = 0;
  }

  return {
    mediaToPreloadScores,
    maxActiveWindowCost,
    directionPenaltyCount,
    reachedScanTimeBudget,
    nextCursor: {
      trackIndex,
      itemIndex: 0,
    },
  };
}

export function collectSourceWarmCandidateScores(
  windows: SourceWarmCandidateWindow[],
): Map<string, number> {
  const candidateScores = new Map<string, number>();

  for (const window of windows) {
    const minFrame = window.anchorFrame - window.windowFrames;
    const maxFrame = window.anchorFrame + window.windowFrames;

    for (const span of window.spans) {
      if (span.endFrame < minFrame || span.startFrame > maxFrame) continue;

      const distance = window.anchorFrame < span.startFrame
        ? span.startFrame - window.anchorFrame
        : window.anchorFrame > span.endFrame
          ? window.anchorFrame - span.endFrame
          : 0;
      const score = window.baseScore + distance;
      const existing = candidateScores.get(span.src);
      if (existing === undefined || score < existing) {
        candidateScores.set(span.src, score);
      }
    }
  }

  return candidateScores;
}
