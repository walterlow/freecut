/**
 * Option catalogs and derivations for the export dialog: resolution choices,
 * one-click quality presets, and the container/codec lists gated by the probed
 * browser capability matrix. Pure — callers supply translations and (when the
 * probe has finished) the supported client codecs.
 */

import type { ExportSettings } from '@/types/export'
import {
  getCompatibleVideoCodecs,
  mapExportCodecToClientCodec,
  type ClientCodec,
  type ClientVideoContainer,
} from '../deps/renderer'

export type VideoContainerOption = {
  value: ClientVideoContainer
  label: string
  description: string
  supported: boolean
}

export type VideoCodecOption = {
  value: ExportSettings['codec']
  label: string
  supported: boolean
}

export type ResolutionOption = {
  value: string
  label: string
}

const VIDEO_CODEC_LABELS: Record<string, string> = {
  h264: 'H.264',
  h265: 'H.265/HEVC',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
}

const VIDEO_CONTAINER_DESCRIPTION_KEYS: Record<ClientVideoContainer, string> = {
  mp4: 'export.videoContainer.mp4',
  mov: 'export.videoContainer.mov',
  webm: 'export.videoContainer.webm',
  mkv: 'export.videoContainer.mkv',
}

const VIDEO_CONTAINERS: ClientVideoContainer[] = ['mp4', 'mov', 'webm', 'mkv']

/** i18next's translator, narrowed to the key/params shape these builders need. */
type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Scale a dimension and round to the nearest even number (encoders require
 * even dimensions). Shared by the resolution dropdown and the quick presets so
 * preset detection compares against identical values.
 */
function scaleDimension(value: number, scale: number): number {
  const scaled = Math.round(value * scale)
  return scaled % 2 === 0 ? scaled : scaled + 1
}

export function scaledResolution(projectWidth: number, projectHeight: number, scale: number) {
  return {
    width: scaleDimension(projectWidth, scale),
    height: scaleDimension(projectHeight, scale),
  }
}

export type ExportPreset = {
  id: 'max' | 'recommended' | 'balanced' | 'small'
  labelKey: string
  container: ClientVideoContainer
  codec: ExportSettings['codec']
  quality: ExportSettings['quality']
  scale: number
}

// One-click targets that bundle container/codec/quality/resolution. All keep the
// project's aspect ratio (scale only) so output is never distorted; they vary the
// quality/size tradeoff, which is the part users shouldn't need codec knowledge for.
export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'max',
    labelKey: 'export.settings.presetMax',
    container: 'mp4',
    codec: 'h264',
    quality: 'ultra',
    scale: 1,
  },
  {
    id: 'recommended',
    labelKey: 'export.settings.presetRecommended',
    container: 'mp4',
    codec: 'h264',
    quality: 'medium',
    scale: 1,
  },
  {
    id: 'balanced',
    labelKey: 'export.settings.presetBalanced',
    container: 'mp4',
    codec: 'h264',
    quality: 'medium',
    scale: 0.666,
  },
  {
    id: 'small',
    labelKey: 'export.settings.presetSmall',
    container: 'mp4',
    codec: 'h264',
    quality: 'low',
    scale: 0.5,
  },
]

/**
 * Generate resolution options based on project dimensions.
 */
export function getResolutionOptions(
  projectWidth: number,
  projectHeight: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): ResolutionOption[] {
  const scales = [1, 0.666, 0.5]

  return scales.map((scale) => {
    const { width, height } = scaledResolution(projectWidth, projectHeight, scale)

    const label =
      scale === 1
        ? t('export.settings.resolutionSameAsProject', { width, height })
        : t('export.settings.resolutionScaled', { p: Math.min(width, height), width, height })

    return { value: `${width}x${height}`, label }
  })
}

/**
 * `supportedVideoCodecs === null` means the capability probe has not reported
 * yet, so every container/codec stays selectable until it does.
 */
export function getVideoContainerOptions(
  supportedVideoCodecs: ClientCodec[] | null,
  t: Translate,
): VideoContainerOption[] {
  return VIDEO_CONTAINERS.map((container) => ({
    value: container,
    label: container === 'mov' ? t('export.settings.quicktimeMov') : container.toUpperCase(),
    description: t(VIDEO_CONTAINER_DESCRIPTION_KEYS[container]),
    supported:
      supportedVideoCodecs === null ||
      getCompatibleVideoCodecs(container)
        .map((codec) => mapExportCodecToClientCodec(codec))
        .some((codec) => supportedVideoCodecs.includes(codec)),
  }))
}

export function getVideoCodecOptions(
  supportedVideoCodecs: ClientCodec[] | null,
  videoContainer: ClientVideoContainer,
): VideoCodecOption[] {
  return getCompatibleVideoCodecs(videoContainer).map((codec) => ({
    value: codec,
    label: VIDEO_CODEC_LABELS[codec] ?? codec.toUpperCase(),
    supported:
      supportedVideoCodecs === null ||
      supportedVideoCodecs.includes(mapExportCodecToClientCodec(codec)),
  }))
}

/**
 * Signature of the fields a preset pins: container, codec, quality, rate
 * control and the resolution its scale produces. Settings and presets are
 * compared as one string so preset detection stays branch-free.
 */
function presetSignature(preset: ExportPreset, projectWidth: number, projectHeight: number): string {
  const resolution = scaledResolution(projectWidth, projectHeight, preset.scale)
  return [
    preset.container,
    preset.codec,
    preset.quality,
    'auto',
    `${resolution.width}x${resolution.height}`,
  ].join('|')
}

function settingsSignature(
  videoContainer: ClientVideoContainer,
  settings: ExportSettings,
): string {
  const { width, height } = settings.resolution
  return [
    videoContainer,
    settings.codec,
    settings.quality,
    settings.rateControl ?? 'auto',
    `${width}x${height}`,
  ].join('|')
}

/** Which preset (if any) the current settings exactly match. null = "Custom". */
export function findActivePresetId(
  videoContainer: ClientVideoContainer,
  settings: ExportSettings,
  projectWidth: number,
  projectHeight: number,
): ExportPreset['id'] | null {
  const signature = settingsSignature(videoContainer, settings)
  const match = EXPORT_PRESETS.find(
    (preset) => presetSignature(preset, projectWidth, projectHeight) === signature,
  )

  return match ? match.id : null
}
