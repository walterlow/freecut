import type { TimelineItem, VideoItem } from '@/types/timeline'

type ReverseConformMode = 'preview' | 'export'

export function hasReadyReverseConform(
  item: TimelineItem,
): item is TimelineItem & { reverseConformSrc: string } {
  return (
    (item.type === 'video' || item.type === 'audio') &&
    item.isReversed === true &&
    item.reverseConformStatus === 'ready' &&
    typeof item.reverseConformSrc === 'string' &&
    item.reverseConformSrc.length > 0
  )
}

export function hasReadyReversePreviewConform(
  item: TimelineItem,
): item is TimelineItem & { reverseConformPreviewSrc: string } {
  return (
    item.type === 'video' &&
    item.isReversed === true &&
    item.reverseConformStatus === 'ready' &&
    typeof item.reverseConformPreviewSrc === 'string' &&
    item.reverseConformPreviewSrc.length > 0
  )
}

export function resolveReverseConformedVideoItem<TItem extends VideoItem>(
  item: TItem,
  timelineFps: number,
  options: { mode?: ReverseConformMode; useProxy?: boolean } = {},
): TItem {
  const canUsePreviewConform =
    options.mode !== 'export' &&
    hasReadyReversePreviewConform(item) &&
    (options.useProxy === true ||
      item.reverseConformPreviewUsesProxy !== true ||
      !hasReadyReverseConform(item))
  const conformSrc = canUsePreviewConform
    ? item.reverseConformPreviewSrc
    : hasReadyReverseConform(item)
      ? item.reverseConformSrc
      : null

  if (!conformSrc) {
    return item
  }

  // When a conformed reversed clip is split, both halves keep the same
  // conform reference but read different ranges of it. `reverseConformLocalStart`
  // is the timeline-frame offset where this clip starts in the conformed media.
  const conformLocalStart = item.reverseConformLocalStart ?? 0
  const conformLocalEnd = conformLocalStart + item.durationInFrames

  return {
    ...item,
    src: conformSrc,
    audioSrc: conformSrc,
    isReversed: undefined,
    speed: 1,
    sourceStart: conformLocalStart,
    trimStart: conformLocalStart,
    offset: conformLocalStart,
    sourceEnd: conformLocalEnd,
    sourceDuration: conformLocalEnd,
    sourceFps: timelineFps,
  }
}
