import type { CompositionInputProps, ExtendedExportSettings } from '@/types/export'
import type { TimelineTrack } from '@/types/timeline'
import { framesToSeconds } from '@/shared/utils/time-utils'
import { isGifUrl, isWebpUrl } from '@/shared/utils/media-utils'
import type { ClientCodec, ClientExportSettings, ClientVideoContainer } from './client-renderer'
import {
  getPreferredContainerForCodec,
  getSupportedCodecs,
  mapToClientSettings,
  selectFallbackVideoCodec,
  validateSettings,
  getDefaultAudioCodec,
  getAudioBitrateForQuality,
  estimateFileSize,
} from './client-renderer'

export type ExportPreflightSeverity = 'ok' | 'info' | 'warning' | 'error'

export interface ExportPreflightCheck {
  id: string
  severity: ExportPreflightSeverity
  titleKey: string
  detailKey: string
  fixKey?: string
  titleParams?: Record<string, unknown>
  detailParams?: Record<string, unknown>
  fixParams?: Record<string, unknown>
}

export interface AssessExportPreflightOptions {
  settings: ExtendedExportSettings
  fps: number
  composition: CompositionInputProps
  durationFrames: number
  supportedVideoCodecs?: ClientCodec[]
  workerAvailable?: boolean
  offlineAudioContextAvailable?: boolean
  brokenMediaIds?: string[]
}

export interface ExportPreflightResult {
  canExport: boolean
  checks: ExportPreflightCheck[]
  resolvedSettings?: ClientExportSettings
  predictedRenderPath: 'worker' | 'main-thread'
  estimatedDurationSeconds: number
  estimatedFileSizeBytes?: number
}

function hasAnimatedImage(tracks: TimelineTrack[]): boolean {
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type !== 'image') continue
      const label = item.label.toLowerCase()
      if (
        isGifUrl(item.src) ||
        isWebpUrl(item.src) ||
        label.endsWith('.gif') ||
        label.endsWith('.webp')
      ) {
        return true
      }
    }
  }
  return false
}

function hasAudibleItem(tracks: TimelineTrack[]): boolean {
  for (const track of tracks) {
    if (track.muted) continue
    for (const item of track.items ?? []) {
      if (
        (item.type === 'audio' || item.type === 'video') &&
        (!('muted' in item) || item.muted !== true)
      ) {
        return true
      }
    }
  }
  return false
}

function collectTimelineMediaIds(tracks: TimelineTrack[]): Set<string> {
  const mediaIds = new Set<string>()
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if ('mediaId' in item && item.mediaId) {
        mediaIds.add(item.mediaId)
      }
    }
  }
  return mediaIds
}

function formatEstimatedBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function describeCodec(codec: ClientCodec): string {
  switch (codec) {
    case 'avc':
      return 'H.264'
    case 'hevc':
      return 'H.265/HEVC'
    case 'vp8':
      return 'VP8'
    case 'vp9':
      return 'VP9'
    case 'av1':
      return 'AV1'
  }
}

function resolveAudioSettings(
  clientSettings: ClientExportSettings,
  settings: ExtendedExportSettings,
): void {
  if (!settings.audioContainer) return
  clientSettings.container = settings.audioContainer
  clientSettings.mode = 'audio'
  clientSettings.audioCodec = getDefaultAudioCodec(settings.audioContainer)
  clientSettings.audioBitrate = getAudioBitrateForQuality(settings.quality)
}

async function resolveSettingsForPreflight(
  settings: ExtendedExportSettings,
  fps: number,
  supportedVideoCodecs?: ClientCodec[],
): Promise<{
  clientSettings?: ClientExportSettings
  codecFallback?: ClientCodec
  error?: string
  supportedVideoCodecs?: ClientCodec[]
}> {
  const exportMode = settings.mode
  const clientSettings = mapToClientSettings(settings, fps)
  clientSettings.mode = exportMode
  clientSettings.embedSubtitles =
    exportMode === 'video' ? (settings.embedSubtitles ?? false) : false

  if (exportMode === 'audio') {
    resolveAudioSettings(clientSettings, settings)
    const validation = validateSettings(clientSettings)
    return validation.valid ? { clientSettings } : { error: validation.error }
  }

  if (settings.videoContainer) {
    clientSettings.container = settings.videoContainer
  }

  const validation = validateSettings(clientSettings)
  if (!validation.valid) return { error: validation.error }

  const codecs =
    supportedVideoCodecs ??
    (await getSupportedCodecs({
      width: clientSettings.resolution.width,
      height: clientSettings.resolution.height,
      bitrate: clientSettings.videoBitrate,
    }))

  if (codecs.includes(clientSettings.codec)) {
    return { clientSettings, supportedVideoCodecs: codecs }
  }

  const containerFallback = selectFallbackVideoCodec(
    codecs,
    clientSettings.container as ClientVideoContainer,
  )

  if (containerFallback) {
    clientSettings.codec = containerFallback
    const postFallbackValidation = validateSettings(clientSettings)
    return postFallbackValidation.valid
      ? { clientSettings, codecFallback: containerFallback, supportedVideoCodecs: codecs }
      : { error: postFallbackValidation.error, supportedVideoCodecs: codecs }
  }

  if (settings.videoContainer) {
    return {
      error: `The selected ${settings.videoContainer.toUpperCase()} format is not supported in this browser. Try a different format or codec.`,
      supportedVideoCodecs: codecs,
    }
  }

  const browserFallback = selectFallbackVideoCodec(codecs)
  if (!browserFallback) {
    return {
      error: 'No supported video codecs available in this browser',
      supportedVideoCodecs: codecs,
    }
  }

  clientSettings.codec = browserFallback
  clientSettings.container = getPreferredContainerForCodec(browserFallback)
  const postFallbackValidation = validateSettings(clientSettings)
  return postFallbackValidation.valid
    ? { clientSettings, codecFallback: browserFallback, supportedVideoCodecs: codecs }
    : { error: postFallbackValidation.error, supportedVideoCodecs: codecs }
}

export async function assessExportPreflight({
  settings,
  fps,
  composition,
  durationFrames,
  supportedVideoCodecs,
  workerAvailable = typeof Worker !== 'undefined',
  offlineAudioContextAvailable = typeof OfflineAudioContext !== 'undefined',
  brokenMediaIds = [],
}: AssessExportPreflightOptions): Promise<ExportPreflightResult> {
  const checks: ExportPreflightCheck[] = []
  const estimatedDurationSeconds = framesToSeconds(durationFrames, fps)
  const resolved = await resolveSettingsForPreflight(settings, fps, supportedVideoCodecs)
  const tracks = composition.tracks ?? []
  const referencedMediaIds = collectTimelineMediaIds(tracks)
  const brokenReferencedCount = brokenMediaIds.filter((mediaId) =>
    referencedMediaIds.has(mediaId),
  ).length

  if (durationFrames <= 0) {
    checks.push({
      id: 'empty-range',
      severity: 'error',
      titleKey: 'export.preflight.checks.empty-range.title',
      detailKey: 'export.preflight.checks.empty-range.detail',
      fixKey: 'export.preflight.checks.empty-range.fix',
    })
  } else {
    checks.push({
      id: 'export-range-ready',
      severity: 'ok',
      titleKey: 'export.preflight.checks.export-range-ready.title',
      detailKey: 'export.preflight.checks.export-range-ready.detail',
      detailParams: {
        frames: durationFrames.toLocaleString(),
        seconds: estimatedDurationSeconds.toFixed(1),
      },
    })
  }

  if (brokenReferencedCount > 0) {
    checks.push({
      id: 'missing-media-blocks-export',
      severity: 'error',
      titleKey: 'export.preflight.checks.missing-media-blocks-export.title',
      detailKey: 'export.preflight.checks.missing-media-blocks-export.detail',
      detailParams: { count: brokenReferencedCount },
      fixKey: 'export.preflight.checks.missing-media-blocks-export.fix',
    })
  }

  if (!resolved.clientSettings) {
    checks.push({
      id: 'video-codec-unavailable',
      severity: 'error',
      titleKey: 'export.preflight.checks.video-codec-unavailable.title',
      detailKey: resolved.error
        ? 'export.preflight.checks.video-codec-unavailable.detailWithError'
        : 'export.preflight.checks.video-codec-unavailable.detail',
      detailParams: { error: resolved.error },
      fixKey: 'export.preflight.checks.video-codec-unavailable.fix',
    })

    return {
      canExport: false,
      checks,
      predictedRenderPath: 'main-thread',
      estimatedDurationSeconds,
    }
  }

  if (resolved.clientSettings.mode === 'audio') {
    checks.push({
      id: 'audio-export-ready',
      severity: 'ok',
      titleKey: 'export.preflight.checks.audio-export-ready.title',
      detailKey: resolved.clientSettings.audioCodec
        ? 'export.preflight.checks.audio-export-ready.detail'
        : 'export.preflight.checks.audio-export-ready.detailDefaultCodec',
      detailParams: {
        container: resolved.clientSettings.container.toUpperCase(),
        codec: resolved.clientSettings.audioCodec,
      },
    })
  } else if (resolved.codecFallback) {
    checks.push({
      id: 'video-codec-fallback',
      severity: 'warning',
      titleKey: 'export.preflight.checks.video-codec-fallback.title',
      detailKey: 'export.preflight.checks.video-codec-fallback.detail',
      detailParams: {
        codec: describeCodec(resolved.codecFallback),
        container: resolved.clientSettings.container.toUpperCase(),
      },
      fixKey: 'export.preflight.checks.video-codec-fallback.fix',
    })
  } else {
    checks.push({
      id: 'video-codec-supported',
      severity: 'ok',
      titleKey: 'export.preflight.checks.video-codec-supported.title',
      detailKey: 'export.preflight.checks.video-codec-supported.detail',
      detailParams: {
        codec: describeCodec(resolved.clientSettings.codec),
        container: resolved.clientSettings.container.toUpperCase(),
      },
    })
  }

  let predictedRenderPath: ExportPreflightResult['predictedRenderPath'] = 'worker'

  if (!workerAvailable) {
    predictedRenderPath = 'main-thread'
    checks.push({
      id: 'worker-unavailable-fallback',
      severity: 'info',
      titleKey: 'export.preflight.checks.worker-unavailable-fallback.title',
      detailKey: 'export.preflight.checks.worker-unavailable-fallback.detail',
      fixKey: 'export.preflight.checks.worker-unavailable-fallback.fix',
    })
  } else if (resolved.clientSettings.mode === 'video' && hasAnimatedImage(tracks)) {
    predictedRenderPath = 'main-thread'
    checks.push({
      id: 'worker-animated-image-fallback',
      severity: 'warning',
      titleKey: 'export.preflight.checks.worker-animated-image-fallback.title',
      detailKey: 'export.preflight.checks.worker-animated-image-fallback.detail',
      fixKey: 'export.preflight.checks.worker-animated-image-fallback.fix',
    })
  } else if (hasAudibleItem(tracks) && !offlineAudioContextAvailable) {
    predictedRenderPath = 'main-thread'
    checks.push({
      id: 'worker-audio-context-fallback',
      severity: 'info',
      titleKey: 'export.preflight.checks.worker-audio-context-fallback.title',
      detailKey: 'export.preflight.checks.worker-audio-context-fallback.detail',
    })
  } else {
    checks.push({
      id: 'worker-export-ready',
      severity: 'ok',
      titleKey: 'export.preflight.checks.worker-export-ready.title',
      detailKey: 'export.preflight.checks.worker-export-ready.detail',
    })
  }

  const estimatedFileSizeBytes = estimateFileSize(
    resolved.clientSettings,
    Math.max(0, estimatedDurationSeconds),
  )

  if (estimatedFileSizeBytes >= 2 * 1024 * 1024 * 1024) {
    checks.push({
      id: 'large-file-risk',
      severity: 'warning',
      titleKey: 'export.preflight.checks.large-file-risk.title',
      detailKey: 'export.preflight.checks.large-file-risk.detail',
      detailParams: { size: formatEstimatedBytes(estimatedFileSizeBytes) },
      fixKey: 'export.preflight.checks.large-file-risk.fix',
    })
  }

  if (estimatedDurationSeconds >= 30 * 60) {
    checks.push({
      id: 'long-export-risk',
      severity: 'warning',
      titleKey: 'export.preflight.checks.long-export-risk.title',
      detailKey: 'export.preflight.checks.long-export-risk.detail',
      detailParams: { minutes: Math.round(estimatedDurationSeconds / 60) },
      fixKey: 'export.preflight.checks.long-export-risk.fix',
    })
  }

  return {
    canExport: !checks.some((check) => check.severity === 'error'),
    checks,
    resolvedSettings: resolved.clientSettings,
    predictedRenderPath,
    estimatedDurationSeconds,
    estimatedFileSizeBytes,
  }
}

export function summarizePreflightSeverity(
  checks: ExportPreflightCheck[],
): ExportPreflightSeverity {
  if (checks.some((check) => check.severity === 'error')) return 'error'
  if (checks.some((check) => check.severity === 'warning')) return 'warning'
  if (checks.some((check) => check.severity === 'info')) return 'info'
  return 'ok'
}
