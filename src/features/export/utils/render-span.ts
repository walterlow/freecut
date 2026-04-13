import type { TimelineItem } from '@/types/timeline';
import type { ActiveTransition } from './canvas-transitions';
import { timelineToSourceFrames } from '@/features/export/deps/timeline';

export interface RenderTimelineSpan {
  from: number;
  durationInFrames: number;
  sourceStart?: number;
}

interface TransitionParticipantFrameWindow {
  from: number;
  durationInFrames: number;
}

function isSourceTimedItem(item: TimelineItem): item is TimelineItem & {
  type: 'video' | 'audio' | 'composition';
  sourceStart?: number;
  trimStart?: number;
  sourceFps?: number;
  speed?: number;
} {
  return item.type === 'video' || item.type === 'audio' || item.type === 'composition';
}

export function getItemRenderTimelineSpan(item: TimelineItem): RenderTimelineSpan {
  return {
    from: item.from,
    durationInFrames: item.durationInFrames,
    ...(isSourceTimedItem(item)
      ? { sourceStart: item.sourceStart ?? item.trimStart ?? 0 }
      : {}),
  };
}

export function getRenderTimelineSourceStart(
  item: TimelineItem,
  span?: RenderTimelineSpan,
): number {
  if (!isSourceTimedItem(item)) {
    return 0;
  }
  return span?.sourceStart ?? item.sourceStart ?? item.trimStart ?? 0;
}

export function applyRenderTimelineSpan<TItem extends TimelineItem>(
  item: TItem,
  span?: RenderTimelineSpan,
): TItem {
  if (!span) {
    return item;
  }

  const hasSameTimelineWindow = item.from === span.from && item.durationInFrames === span.durationInFrames;
  const nextSourceStart = getRenderTimelineSourceStart(item, span);
  const currentSourceStart = isSourceTimedItem(item)
    ? (item.sourceStart ?? item.trimStart ?? 0)
    : undefined;
  const hasSameSourceAnchor = currentSourceStart === nextSourceStart;

  if (hasSameTimelineWindow && hasSameSourceAnchor) {
    return item;
  }

  return {
    ...item,
    from: span.from,
    durationInFrames: span.durationInFrames,
    ...(isSourceTimedItem(item) ? { sourceStart: nextSourceStart } : {}),
  };
}

function resolveTransitionParticipantFrameWindow<TItem extends TimelineItem>(
  clip: TItem,
  activeTransition: Pick<ActiveTransition<TItem>, 'transitionStart' | 'transitionEnd'>,
): TransitionParticipantFrameWindow {
  const beforeFrames = Math.max(0, clip.from - activeTransition.transitionStart);
  const clipEnd = clip.from + clip.durationInFrames;
  const afterFrames = Math.max(0, activeTransition.transitionEnd - clipEnd);

  return {
    from: clip.from - beforeFrames,
    durationInFrames: clip.durationInFrames + beforeFrames + afterFrames,
  };
}

function getTransitionParticipantSourceStart<TItem extends TimelineItem>(
  clip: TItem,
  transitionWindow: TransitionParticipantFrameWindow,
  fps: number,
): number | undefined {
  if (!isSourceTimedItem(clip)) {
    return undefined;
  }

  const beforeFrames = Math.max(0, clip.from - transitionWindow.from);
  if (beforeFrames <= 0) {
    return clip.sourceStart ?? clip.trimStart ?? 0;
  }

  const sourceStart = clip.sourceStart ?? clip.trimStart ?? 0;
  const speed = clip.speed ?? 1;
  const sourceFps = clip.sourceFps ?? fps;
  const prerollSourceFrames = timelineToSourceFrames(beforeFrames, speed, fps, sourceFps);
  return Math.max(0, sourceStart - prerollSourceFrames);
}

export function resolveTransitionRenderTimelineSpan<TItem extends TimelineItem>(
  clip: TItem,
  activeTransition: Pick<ActiveTransition<TItem>, 'transitionStart' | 'transitionEnd'>,
  fps: number,
): RenderTimelineSpan {
  const transitionWindow = resolveTransitionParticipantFrameWindow(clip, activeTransition);
  return {
    from: transitionWindow.from,
    durationInFrames: transitionWindow.durationInFrames,
    ...(getTransitionParticipantSourceStart(clip, transitionWindow, fps) !== undefined
      ? { sourceStart: getTransitionParticipantSourceStart(clip, transitionWindow, fps) }
      : {}),
  };
}
