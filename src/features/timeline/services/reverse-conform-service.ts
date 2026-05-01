import type { CompositionInputProps } from '@/types/export'
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import {
  renderComposition,
  type ClientExportSettings,
  type RenderProgress,
} from '../deps/export-contract'
import {
  mirrorBlobToWorkspace,
  readWorkspaceBlob,
} from '@/infrastructure/storage/workspace-fs/cache-mirror'
import { reverseConformFilePath } from '@/infrastructure/storage/workspace-fs/paths'
import { opfsService } from '../deps/media-library-service'
import { resolveMediaUrls } from '../deps/media-library-resolver'

export interface ReverseConformResult {
  itemId: string
  src: string
  path: string
  key: string
  quality: ReverseConformQuality
  usesProxy: boolean
}

type ReverseConformQuality = 'preview' | 'full'

interface ReverseConformPrepareOptions {
  quality?: ReverseConformQuality
  useProxy?: boolean
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}

const inFlightByKey = new Map<string, Promise<ReverseConformResult>>()

function toSafeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180)
}

function getSourceStart(item: VideoItem): number {
  return item.sourceStart ?? item.trimStart ?? item.offset ?? 0
}

function getSourceEnd(item: VideoItem, timelineFps: number): number {
  const sourceFps = item.sourceFps ?? timelineFps
  const speed = item.speed ?? 1
  const sourceFramesNeeded = (item.durationInFrames * speed * sourceFps) / timelineFps
  return item.sourceEnd ?? getSourceStart(item) + sourceFramesNeeded
}

function getReverseConformKey(
  item: VideoItem,
  timelineFps: number,
  quality: ReverseConformQuality,
  useProxy: boolean,
): string {
  return toSafeKey(
    [
      'v2',
      quality,
      quality === 'preview' && useProxy ? 'proxy' : 'source',
      item.mediaId ?? 'legacy',
      item.mediaId ? `media:${item.mediaId}` : item.src,
      getSourceStart(item),
      getSourceEnd(item, timelineFps),
      item.durationInFrames,
      item.sourceFps ?? timelineFps,
      timelineFps,
      item.speed ?? 1,
    ].join('__'),
  )
}

function createObjectUrl(blob: Blob): string {
  return URL.createObjectURL(new Blob([blob], { type: blob.type || 'video/mp4' }))
}

async function saveBlobToOpfs(path: string, blob: Blob): Promise<void> {
  await opfsService.saveFile(path, await blob.arrayBuffer())
}

async function loadCachedBlob(pathSegments: string[], opfsPath: string): Promise<Blob | null> {
  const workspaceBlob = await readWorkspaceBlob(pathSegments)
  if (workspaceBlob) return workspaceBlob

  try {
    return await opfsService.getFileBlob(opfsPath)
  } catch {
    return null
  }
}

function getConformDimensions(
  item: VideoItem,
  quality: ReverseConformQuality,
): { width: number; height: number } {
  const sourceWidth = Math.max(2, item.sourceWidth ?? 1920)
  const sourceHeight = Math.max(2, item.sourceHeight ?? 1080)
  if (quality === 'full') {
    return { width: sourceWidth, height: sourceHeight }
  }

  const maxWidth = 1280
  const maxHeight = 720
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight)
  return {
    width: Math.max(2, Math.round(sourceWidth * scale)),
    height: Math.max(2, Math.round(sourceHeight * scale)),
  }
}

function buildConformComposition(
  item: VideoItem,
  timelineFps: number,
  quality: ReverseConformQuality,
): CompositionInputProps {
  const { width, height } = getConformDimensions(item, quality)
  const track: TimelineTrack = {
    id: 'reverse-conform-track',
    name: 'Reverse conform',
    order: 0,
    height: 80,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    items: [],
  }
  const conformItem: VideoItem = {
    ...item,
    id: `${item.id}:reverse-conform`,
    trackId: track.id,
    from: 0,
    durationInFrames: item.durationInFrames,
    isReversed: true,
    reverseConformSrc: undefined,
    reverseConformPath: undefined,
    reverseConformPreviewSrc: undefined,
    reverseConformPreviewPath: undefined,
    reverseConformStatus: undefined,
    sourceStart: getSourceStart(item),
    sourceEnd: getSourceEnd(item, timelineFps),
    sourceFps: item.sourceFps ?? timelineFps,
    transform: {
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      opacity: 1,
    },
    crop: undefined,
    effects: undefined,
    fadeIn: undefined,
    fadeOut: undefined,
  }
  track.items = [conformItem]

  return {
    fps: timelineFps,
    width,
    height,
    durationInFrames: item.durationInFrames,
    tracks: [track],
    transitions: [],
    backgroundColor: '#000000',
  }
}

function buildConformSettings(
  item: VideoItem,
  timelineFps: number,
  quality: ReverseConformQuality,
): ClientExportSettings {
  const { width, height } = getConformDimensions(item, quality)
  return {
    mode: 'video',
    codec: 'avc',
    container: 'mp4',
    quality: quality === 'preview' ? 'medium' : 'high',
    resolution: { width, height },
    fps: timelineFps,
    videoBitrate:
      quality === 'preview'
        ? Math.max(2_500_000, width * height * timelineFps * 0.08)
        : Math.max(12_000_000, width * height * timelineFps * 0.16),
    audioBitrate: quality === 'preview' ? 128_000 : 192_000,
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw new DOMException('Reverse conform cancelled', 'AbortError')
}

function scaleRenderProgress(progress: RenderProgress): number {
  if (progress.phase === 'rendering') {
    return 0.15 + progress.progress * 0.008
  }
  if (progress.phase === 'finalizing') {
    return 0.95 + progress.progress * 0.0005
  }
  return progress.progress * 0.0015
}

export const reverseConformService = {
  async hydrateItem(item: TimelineItem): Promise<TimelineItem> {
    if (item.isReversed !== true || item.reverseConformStatus !== 'ready') {
      return item
    }

    const next = { ...item }

    if (item.type === 'video' && item.reverseConformPreviewPath) {
      const blob = await loadCachedBlob(
        item.reverseConformPreviewPath.split('/').filter(Boolean),
        item.reverseConformPreviewPath,
      )
      if (blob) {
        next.reverseConformPreviewSrc = createObjectUrl(blob)
      } else {
        next.reverseConformPreviewSrc = undefined
      }
    } else if (item.type === 'video' && item.reverseConformPreviewSrc?.startsWith('blob:')) {
      next.reverseConformPreviewSrc = undefined
    }

    if (item.reverseConformPath) {
      const blob = await loadCachedBlob(
        item.reverseConformPath.split('/').filter(Boolean),
        item.reverseConformPath,
      )
      if (blob) {
        next.reverseConformSrc = createObjectUrl(blob)
      } else {
        next.reverseConformSrc = undefined
      }
    } else if (item.reverseConformSrc?.startsWith('blob:')) {
      next.reverseConformSrc = undefined
    }

    return next
  },

  async hydrateItems(items: TimelineItem[]): Promise<TimelineItem[]> {
    return Promise.all(items.map((item) => reverseConformService.hydrateItem(item)))
  },

  async prepareVideo(
    item: VideoItem,
    timelineFps: number,
    options: ReverseConformPrepareOptions = {},
  ): Promise<ReverseConformResult> {
    const quality = options.quality ?? 'preview'
    const useProxy = quality === 'preview' && options.useProxy !== false
    throwIfAborted(options.signal)
    if (!item.src || item.durationInFrames <= 0) {
      throw new Error('Cannot reverse an empty video clip')
    }
    const key = getReverseConformKey(item, timelineFps, quality, useProxy)
    const mediaId = item.mediaId ?? item.id
    const pathSegments = reverseConformFilePath(mediaId, key)
    const opfsPath = pathSegments.join('/')

    const existing = inFlightByKey.get(key)
    if (existing) {
      return existing
    }

    const job = (async () => {
      options.onProgress?.(0)
      const cached = await loadCachedBlob(pathSegments, opfsPath)
      throwIfAborted(options.signal)
      if (cached) {
        options.onProgress?.(1)
        return {
          itemId: item.id,
          src: createObjectUrl(cached),
          path: opfsPath,
          key,
          quality,
          usesProxy: useProxy,
        }
      }

      const onProgress = (progress: RenderProgress) => {
        options.onProgress?.(Math.max(0, Math.min(0.99, scaleRenderProgress(progress))))
      }
      const composition = buildConformComposition(item, timelineFps, quality)
      composition.tracks = await resolveMediaUrls(composition.tracks, {
        useProxy,
        signal: options.signal,
      })
      throwIfAborted(options.signal)
      const resolvedItem = composition.tracks[0]?.items[0]
      if (!resolvedItem || resolvedItem.type !== 'video' || !resolvedItem.src) {
        throw new Error('Could not resolve the source media for reverse.')
      }
      const result = await renderComposition({
        composition,
        settings: buildConformSettings(item, timelineFps, quality),
        onProgress,
        signal: options.signal,
      })
      throwIfAborted(options.signal)
      await saveBlobToOpfs(opfsPath, result.blob)
      throwIfAborted(options.signal)
      await mirrorBlobToWorkspace(pathSegments, result.blob)
      throwIfAborted(options.signal)
      options.onProgress?.(1)

      return {
        itemId: item.id,
        src: createObjectUrl(result.blob),
        path: opfsPath,
        key,
        quality,
        usesProxy: useProxy,
      }
    })().finally(() => {
      inFlightByKey.delete(key)
    })

    inFlightByKey.set(key, job)
    return job
  },
}
