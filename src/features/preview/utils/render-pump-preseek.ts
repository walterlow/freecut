import { getVideoTargetTimeSeconds } from '@/features/preview/deps/composition-runtime';
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline';

export interface RenderPumpSourceTimeOptions {
  requireExplicitSourceFps?: boolean;
}

export interface PreseekSourceTarget {
  src: string;
  time: number;
}

function isPreseekableVideoItem(item: TimelineItem): item is VideoItem {
  return item.type === 'video' && typeof item.src === 'string' && item.src.length > 0;
}

function appendSourceTimeBySrc(bySource: Map<string, number[]>, src: string, time: number) {
  const existing = bySource.get(src);
  if (existing) {
    existing.push(time);
  } else {
    bySource.set(src, [time]);
  }
}

export function getVideoItemSourceTimeSeconds(
  item: TimelineItem,
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions = {},
): number | null {
  if (!isPreseekableVideoItem(item)) return null;

  const localFrame = timelineFrame - item.from;
  if (localFrame < 0 || localFrame >= item.durationInFrames) return null;

  const sourceFps = options.requireExplicitSourceFps
    ? item.sourceFps
    : (item.sourceFps ?? timelineFps);
  if (!Number.isFinite(sourceFps) || !sourceFps || sourceFps <= 0) {
    return null;
  }

  return getVideoTargetTimeSeconds(
    item.sourceStart ?? item.trimStart ?? 0,
    sourceFps,
    localFrame,
    item.speed ?? 1,
    timelineFps,
  );
}

export function collectVisibleTrackVideoSourceTimesBySrc(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions & {
    filter?: (item: VideoItem) => boolean;
  } = {},
): Map<string, number[]> {
  const bySource = new Map<string, number[]>();

  for (const track of tracks) {
    for (const item of track.items) {
      if (!isPreseekableVideoItem(item)) continue;
      if (options.filter && !options.filter(item)) continue;

      const sourceTime = getVideoItemSourceTimeSeconds(
        item,
        timelineFrame,
        timelineFps,
        options,
      );
      if (sourceTime === null) continue;
      appendSourceTimeBySrc(bySource, item.src, sourceTime);
    }
  }

  return bySource;
}

export function collectClipVideoSourceTimesBySrcForFrame(
  items: TimelineItem[],
  timelineFrame: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions = {},
): Map<string, number[]> {
  const bySource = new Map<string, number[]>();

  for (const item of items) {
    if (!isPreseekableVideoItem(item)) continue;

    const sourceTime = getVideoItemSourceTimeSeconds(
      item,
      timelineFrame,
      timelineFps,
      options,
    );
    if (sourceTime === null) continue;
    appendSourceTimeBySrc(bySource, item.src, sourceTime);
  }

  return bySource;
}

export function collectClipVideoSourceTimesBySrcForFrameRange(
  items: TimelineItem[],
  startFrame: number,
  frameCount: number,
  timelineFps: number,
  options: RenderPumpSourceTimeOptions = {},
): Map<string, number[]> {
  const bySource = new Map<string, number[]>();
  const safeFrameCount = Math.max(0, Math.floor(frameCount));

  for (const item of items) {
    if (!isPreseekableVideoItem(item)) continue;
    for (let offset = 0; offset < safeFrameCount; offset += 1) {
      const sourceTime = getVideoItemSourceTimeSeconds(
        item,
        startFrame + offset,
        timelineFps,
        options,
      );
      if (sourceTime === null) continue;
      appendSourceTimeBySrc(bySource, item.src, sourceTime);
    }
  }

  return bySource;
}

export function collectPlaybackStartVariableSpeedPrewarmItemIds(
  tracks: TimelineTrack[],
  timelineFrame: number,
): string[] {
  const itemIds: string[] = [];

  for (const track of tracks) {
    for (const item of track.items) {
      if (!isPreseekableVideoItem(item)) continue;
      if (timelineFrame < item.from || timelineFrame >= item.from + item.durationInFrames) continue;

      const speed = item.speed ?? 1;
      if (Math.abs(speed - 1) < 0.01) continue;

      const framesIntoClip = timelineFrame - item.from;
      if (framesIntoClip <= 2) {
        itemIds.push(item.id);
      }
    }
  }

  return itemIds;
}

export function collectPlaybackStartVariableSpeedPreseekTargets(
  tracks: TimelineTrack[],
  timelineFrame: number,
  timelineFps: number,
  lookaheadFrames: number,
): PreseekSourceTarget[] {
  const targets: PreseekSourceTarget[] = [];

  for (const track of tracks) {
    for (const item of track.items) {
      if (!isPreseekableVideoItem(item)) continue;

      const speed = item.speed ?? 1;
      if (Math.abs(speed - 1) < 0.01) continue;

      const itemEnd = item.from + item.durationInFrames;
      if (item.from > timelineFrame + lookaheadFrames || itemEnd <= timelineFrame) continue;

      const targetFrame = Math.min(timelineFrame + lookaheadFrames, itemEnd - 1);
      const sourceTime = getVideoItemSourceTimeSeconds(item, targetFrame, timelineFps);
      if (sourceTime === null) continue;

      targets.push({
        src: item.src,
        time: sourceTime,
      });
    }
  }

  return targets;
}
