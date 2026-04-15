import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import type { SubComposition } from '../deps/timeline-contract';
import { timelineToSourceFrames } from '../deps/timeline-utils';

interface VisibleVideoAtFrameOptions {
  compositionById?: Record<string, SubComposition>;
  fps?: number;
  maxDepth?: number;
}

const DEFAULT_TIMELINE_FPS = 30;
const DEFAULT_MAX_DEPTH = 8;

function itemCoversFrame(item: TimelineItem, frame: number): boolean {
  return frame >= item.from && frame < (item.from + item.durationInFrames);
}

function hasVisibleVideoInTracks(
  tracks: TimelineTrack[],
  frame: number,
  options: VisibleVideoAtFrameOptions,
  visitedCompositionIds: Set<string>,
  depth: number,
): boolean {
  return tracks.some((track) => {
    if (!track.visible) return false;
    return track.items.some((item) => hasVisibleVideoInItem(
      item,
      frame,
      options,
      visitedCompositionIds,
      depth,
    ));
  });
}

function hasVisibleVideoInItem(
  item: TimelineItem,
  frame: number,
  options: VisibleVideoAtFrameOptions,
  visitedCompositionIds: Set<string>,
  depth: number,
): boolean {
  if (!itemCoversFrame(item, frame)) {
    return false;
  }

  if (item.type === 'video') {
    return true;
  }

  if (item.type !== 'composition' || !item.compositionId) {
    return false;
  }

  const compositionById = options.compositionById;
  if (!compositionById || depth >= (options.maxDepth ?? DEFAULT_MAX_DEPTH)) {
    return false;
  }

  const subComposition = compositionById[item.compositionId];
  if (!subComposition || visitedCompositionIds.has(item.compositionId)) {
    return false;
  }

  const parentFps = options.fps ?? DEFAULT_TIMELINE_FPS;
  const subCompositionFps = subComposition.fps > 0 ? subComposition.fps : parentFps;
  const sourceFps = item.sourceFps ?? subCompositionFps;
  const speed = item.speed ?? 1;
  const sourceStart = item.sourceStart ?? item.trimStart ?? 0;
  const localFrame = Math.max(0, frame - item.from);
  const subCompositionFrame = sourceStart + timelineToSourceFrames(
    localFrame,
    speed,
    parentFps,
    sourceFps,
  );
  const sourceEnd = item.sourceEnd
    ?? (sourceStart + timelineToSourceFrames(item.durationInFrames, speed, parentFps, sourceFps));

  if (subCompositionFrame < sourceStart || subCompositionFrame >= sourceEnd) {
    return false;
  }

  const nextVisitedCompositionIds = new Set(visitedCompositionIds);
  nextVisitedCompositionIds.add(item.compositionId);
  return hasVisibleVideoInTracks(
    subComposition.tracks,
    subCompositionFrame,
    {
      ...options,
      fps: subCompositionFps,
    },
    nextVisitedCompositionIds,
    depth + 1,
  );
}

export function hasVisibleVideoAtFrame(
  tracks: TimelineTrack[],
  frame: number,
  options: VisibleVideoAtFrameOptions = {},
): boolean {
  return hasVisibleVideoInTracks(tracks, frame, options, new Set<string>(), 0);
}
