import type { TimelineItem } from '@/types/timeline';
import { getVideoTargetTimeSeconds } from '@/lib/composition-runtime/utils/video-timing';
import { formatTimecode } from '@/utils/time-utils';

export interface SourceFrameInfo {
  sourceTime: number;
  sourceFrame: number;
  sourceFps: number;
  timecode: string;
}

export function getSourceFrameInfo(
  item: TimelineItem,
  localFrame: number,
  timelineFps: number,
): SourceFrameInfo {
  const sourceFps = item.sourceFps ?? timelineFps;
  const sourceRate = item.speed ?? 1;
  const sourceStart = item.sourceStart ?? 0;

  const sourceTime = getVideoTargetTimeSeconds(
    sourceStart,
    sourceFps,
    localFrame,
    sourceRate,
    timelineFps,
    0,
  );
  const sourceFrame = Math.max(0, Math.round(sourceTime * sourceFps));

  return {
    sourceTime,
    sourceFrame,
    sourceFps,
    timecode: formatTimecode(sourceFrame, sourceFps),
  };
}
