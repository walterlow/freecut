import type { AudioItem, ImageItem, LottieItem, TimelineItem, VideoItem } from '@/types/timeline'
import {
  DEFAULT_PROJECTION_360_SETTINGS,
  is360Filename,
  isEquirectangularDimensions,
} from '@/types/projection360'
import { computeInitialTransform } from './transform-init'

export type MediaTimelineItemType = 'video' | 'audio' | 'image' | 'lottie'

export interface MediaTimelinePlacement {
  trackId: string
  from: number
  durationInFrames?: number
}

export interface LinkedMediaTimelinePlacement {
  primary: MediaTimelinePlacement
  linkedAudio?: MediaTimelinePlacement
}

export interface MediaSourceTiming {
  sourceFps: number
  sourceStart: number
  sourceEnd: number
  sourceDuration: number
  durationInFrames: number
}

interface TimelineMediaMetadata {
  duration: number
  fps?: number
  width?: number
  height?: number
}

interface TimelineBaseItem {
  id: string
  trackId: string
  from: number
  durationInFrames: number
  label: string
  mediaId: string
  originId: string
  linkedGroupId?: string
  sourceStart: number
  sourceEnd: number
  sourceDuration: number
  sourceFps: number
  trimStart: number
  trimEnd: number
}

export function getMediaSourceTiming(params: {
  media: Pick<TimelineMediaMetadata, 'duration' | 'fps'>
  mediaType: MediaTimelineItemType
  projectFps: number
  sourceStart?: number
  sourceEnd?: number
  durationInFrames?: number
  fallbackSourceFps?: number
}): MediaSourceTiming {
  const { media, mediaType, projectFps, sourceStart = 0, fallbackSourceFps = projectFps } = params
  const sourceFps = media.fps || fallbackSourceFps
  const sourceDuration =
    mediaType === 'image' ? projectFps * 3 : Math.max(1, Math.round(media.duration * sourceFps))
  const sourceEnd =
    params.sourceEnd ??
    (params.durationInFrames !== undefined
      ? Math.min(
          sourceDuration,
          sourceStart + Math.round((params.durationInFrames * sourceFps) / projectFps),
        )
      : sourceDuration)
  const durationInFrames =
    params.durationInFrames ??
    (sourceFps === projectFps
      ? sourceEnd - sourceStart
      : Math.max(1, Math.round(((sourceEnd - sourceStart) * projectFps) / sourceFps)))

  return {
    sourceFps,
    sourceStart,
    sourceEnd,
    sourceDuration,
    durationInFrames,
  }
}

function buildTimelineBaseItem(params: {
  media: Pick<TimelineMediaMetadata, 'duration' | 'fps'>
  mediaId: string
  mediaType: MediaTimelineItemType
  label: string
  projectFps: number
  placement: MediaTimelinePlacement
  originId: string
  linkedGroupId?: string
  sourceStart?: number
  sourceEnd?: number
  fallbackSourceFps?: number
}): TimelineBaseItem {
  const timing = getMediaSourceTiming({
    media: params.media,
    mediaType: params.mediaType,
    projectFps: params.projectFps,
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    durationInFrames: params.placement.durationInFrames,
    fallbackSourceFps: params.fallbackSourceFps,
  })

  return {
    id: crypto.randomUUID(),
    trackId: params.placement.trackId,
    from: params.placement.from,
    durationInFrames: timing.durationInFrames,
    label: params.label,
    mediaId: params.mediaId,
    originId: params.originId,
    linkedGroupId: params.linkedGroupId,
    sourceStart: timing.sourceStart,
    sourceEnd: timing.sourceEnd,
    sourceDuration: timing.sourceDuration,
    sourceFps: timing.sourceFps,
    trimStart: 0,
    trimEnd: 0,
  }
}

export function buildMediaTimelineItem(params: {
  media: TimelineMediaMetadata
  mediaId: string
  mediaType: MediaTimelineItemType
  label: string
  projectFps: number
  blobUrl: string
  thumbnailUrl?: string | null
  canvasWidth: number
  canvasHeight: number
  placement: MediaTimelinePlacement
  originId: string
  linkedGroupId?: string
  sourceStart?: number
  sourceEnd?: number
  fallbackSourceFps?: number
}): TimelineItem {
  const baseItem = buildTimelineBaseItem(params)

  if (params.mediaType === 'audio') {
    return {
      ...baseItem,
      type: 'audio',
      src: params.blobUrl,
    } as AudioItem
  }

  const sourceWidth = params.media.width || params.canvasWidth
  const sourceHeight = params.media.height || params.canvasHeight
  const isSpherical360 =
    params.media.projectionType === 'spherical_360' ||
    params.media.is360 === true ||
    (params.media.projectionType !== 'ultrawide' &&
      ((params.media.width &&
        params.media.height &&
        isEquirectangularDimensions(params.media.width, params.media.height)) ||
        is360Filename(params.label)))
  const isUltrawide =
    params.media.projectionType === 'ultrawide' ||
    (!isSpherical360 &&
      params.media.width &&
      params.media.height &&
      params.media.width / params.media.height >= 1.85)
  const projection360 = isSpherical360
    ? { ...DEFAULT_PROJECTION_360_SETTINGS, sourceMode: 'spherical_360' as const, preset: 'linear' as const, enabled: true }
    : isUltrawide
      ? { ...DEFAULT_PROJECTION_360_SETTINGS, sourceMode: 'ultrawide' as const, preset: 'linear' as const, enabled: false }
      : undefined

  const visualFields = {
    src: params.blobUrl,
    thumbnailUrl: params.thumbnailUrl || undefined,
    sourceWidth: params.media.width || undefined,
    sourceHeight: params.media.height || undefined,
    projection360,
    transform: computeInitialTransform(
      sourceWidth,
      sourceHeight,
      params.canvasWidth,
      params.canvasHeight,
    ),
  }

  if (params.mediaType === 'video') {
    return {
      ...baseItem,
      type: 'video',
      ...visualFields,
    } as VideoItem
  }

  if (params.mediaType === 'lottie') {
    const frameRate = params.media.fps || 30
    return {
      ...baseItem,
      type: 'lottie',
      ...visualFields,
      frameRate,
      totalFrames: Math.max(1, Math.round((params.media.duration || 0) * frameRate)),
      loop: true,
    } as LottieItem
  }

  return {
    ...baseItem,
    type: 'image',
    ...visualFields,
  } as ImageItem
}

export function buildMediaTimelineItems(params: {
  media: TimelineMediaMetadata
  mediaId: string
  mediaType: MediaTimelineItemType
  label: string
  projectFps: number
  blobUrl: string
  thumbnailUrl?: string | null
  canvasWidth: number
  canvasHeight: number
  placements: LinkedMediaTimelinePlacement
  linkVideoAudio?: boolean
  sourceStart?: number
  sourceEnd?: number
  fallbackSourceFps?: number
  createLinkedGroupId?: boolean
}): TimelineItem[] {
  const originId = crypto.randomUUID()
  const linkedGroupId =
    params.mediaType === 'video' && (params.linkVideoAudio || params.createLinkedGroupId)
      ? crypto.randomUUID()
      : undefined
  const primaryItem = buildMediaTimelineItem({
    ...params,
    placement: params.placements.primary,
    originId,
    linkedGroupId,
  })

  if (params.mediaType !== 'video' || !params.linkVideoAudio || !params.placements.linkedAudio) {
    return [primaryItem]
  }

  const linkedAudio = buildMediaTimelineItem({
    ...params,
    mediaType: 'audio',
    thumbnailUrl: null,
    placement: params.placements.linkedAudio,
    originId,
    linkedGroupId,
  })

  return [primaryItem, linkedAudio]
}
