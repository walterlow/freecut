import type { TimelineItem } from '@/types/timeline'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { sourceToTimelineFrames, timelineToSourceFrames } from './source-calculations'

function lookupMediaFps(mediaId: string | undefined): number | undefined {
  if (!mediaId) return undefined
  const fps = useMediaLibraryStore.getState().mediaById[mediaId]?.fps
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : undefined
}

export function getMediaSourceFps(item: TimelineItem, timelineFps: number): number {
  if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') {
    return timelineFps
  }
  if (item.sourceFps !== undefined) return item.sourceFps
  const mediaId = item.type === 'composition' ? undefined : item.mediaId
  return lookupMediaFps(mediaId) ?? timelineFps
}

export function getMediaSpeed(item: TimelineItem): number {
  return item.type === 'video' || item.type === 'audio' || item.type === 'composition'
    ? (item.speed ?? 1)
    : 1
}

export function sourceSecondsToTimelineFrame(
  item: TimelineItem,
  sourceSeconds: number,
  timelineFps: number,
): number {
  const sourceFps = getMediaSourceFps(item, timelineFps)
  const sourceFrame = Math.round(sourceSeconds * sourceFps)
  const sourceStart = item.type === 'video' || item.type === 'audio' ? (item.sourceStart ?? 0) : 0
  const deltaSourceFrames = sourceFrame - sourceStart
  const timelineDelta = sourceToTimelineFrames(
    deltaSourceFrames,
    getMediaSpeed(item),
    sourceFps,
    timelineFps,
  )
  return Math.round(item.from + timelineDelta)
}

export function getItemSourceSpanSeconds(
  item: TimelineItem,
  timelineFps: number,
): { start: number; end: number } | null {
  if (item.type !== 'video' && item.type !== 'audio') return null
  const sourceFps = getMediaSourceFps(item, timelineFps)
  const sourceStart = item.sourceStart ?? 0
  const sourceFrames = timelineToSourceFrames(
    item.durationInFrames,
    getMediaSpeed(item),
    timelineFps,
    sourceFps,
  )
  return {
    start: sourceStart / sourceFps,
    end: (sourceStart + sourceFrames) / sourceFps,
  }
}
