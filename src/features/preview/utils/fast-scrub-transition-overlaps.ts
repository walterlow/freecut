import { resolveTransitionWindows } from '@/domain/timeline/transitions/transition-planner';
import type { TimelineItem, TimelineTrack, VideoItem, ImageItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';

export interface FastScrubTransitionWindow {
  startFrame: number;
  endFrame: number;
  srcs: string[];
}

function isTransitionClipItem(item: TimelineItem): item is VideoItem | ImageItem {
  return item.type === 'video' || item.type === 'image';
}

export function collectFastScrubTransitionWindows(
  tracks: Array<Pick<TimelineTrack, 'items'>>,
  transitions: Transition[],
): FastScrubTransitionWindow[] {
  if (tracks.length === 0 || transitions.length === 0) return [];

  const itemsById = new Map<string, VideoItem | ImageItem>();
  for (const track of tracks) {
    for (const item of track.items) {
      if (!isTransitionClipItem(item)) continue;
      itemsById.set(item.id, item);
    }
  }

  return resolveTransitionWindows(transitions, itemsById).map((window) => {
    const srcs = new Set<string>();
    if (window.leftClip.type === 'video' && window.leftClip.src) {
      srcs.add(window.leftClip.src);
    }
    if (window.rightClip.type === 'video' && window.rightClip.src) {
      srcs.add(window.rightClip.src);
    }
    return {
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      srcs: [...srcs],
    };
  });
}

export function collectTransitionOverlapNeighborFrames({
  targetFrame,
  direction,
  window,
  neighborFrames = 2,
  approachFrames = 2,
}: {
  targetFrame: number;
  direction: -1 | 0 | 1;
  window: FastScrubTransitionWindow;
  neighborFrames?: number;
  approachFrames?: number;
}): number[] {
  const firstFrame = window.startFrame;
  const lastFrame = window.endFrame - 1;
  if (lastFrame < firstFrame) return [];

  const clampedNeighborFrames = Math.max(1, Math.floor(neighborFrames));
  const clampedApproachFrames = Math.max(0, Math.floor(approachFrames));
  const frames: number[] = [];
  const seen = new Set<number>();

  const pushFrame = (frame: number) => {
    if (frame < firstFrame || frame > lastFrame) return;
    if (seen.has(frame)) return;
    seen.add(frame);
    frames.push(frame);
  };

  if (targetFrame < firstFrame) {
    if ((firstFrame - targetFrame) > clampedApproachFrames) return [];
    for (let i = 0; i < clampedNeighborFrames; i += 1) {
      pushFrame(firstFrame + i);
    }
    return frames;
  }

  if (targetFrame > lastFrame) {
    if ((targetFrame - lastFrame) > clampedApproachFrames) return [];
    for (let i = 0; i < clampedNeighborFrames; i += 1) {
      pushFrame(lastFrame - i);
    }
    return frames;
  }

  const orderedOffsets = direction > 0
    ? [1, 2, -1, -2]
    : direction < 0
      ? [-1, -2, 1, 2]
      : [-1, 1, -2, 2];

  for (const offset of orderedOffsets) {
    pushFrame(targetFrame + offset);
    if (frames.length >= clampedNeighborFrames) break;
  }

  return frames;
}

export function isFrameNearTransitionOverlap(
  targetFrame: number,
  window: FastScrubTransitionWindow,
  approachFrames = 2,
): boolean {
  const clampedApproachFrames = Math.max(0, Math.floor(approachFrames));
  return targetFrame >= (window.startFrame - clampedApproachFrames)
    && targetFrame < (window.endFrame + clampedApproachFrames);
}
