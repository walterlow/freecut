/**
 * Pure policy and derivations for the client render orchestrator.
 *
 * These decisions were inline in `canvas-render-orchestrator.ts`. They decide
 * *what* an export does — windowed audio, subtitle muxing vs burn-in, render vs
 * export resolution, muxed audio codec — and describe it for the start-of-render
 * log line, while the orchestrator keeps owning every resource (canvas, encoder
 * sources, output target) and the frame loop. Nothing here allocates GPU or
 * encoder resources, so moving a decision out can never change when the render
 * starts.
 */

import type { CompositionInputProps, SubtitleExportMode } from '@/types/export'
import type { ClientContainer, ClientExportSettings } from './client-renderer'
import { getDefaultAudioCodec } from './client-renderer'
import {
  buildTranscriptSubtitleWebVtt,
  omitTranscriptSubtitleItemsForSoftSubtitleExport,
  resolveSubtitleExportPlan,
} from './embedded-subtitle-export'

/**
 * Windowed audio processing bounds decoded PCM memory, but only pays off past
 * this export duration.
 */
const WINDOWED_AUDIO_MIN_DURATION_SECONDS = 5 * 60

export interface WindowedAudioProcessingOptions {
  hasAudioContent: boolean
  durationSeconds: number
  /**
   * Deferred so the capability probe keeps its original short-circuit: it must
   * not be consulted for silent or short exports.
   */
  supportsWindowedProcessing: () => boolean
}

export function shouldUseWindowedAudioProcessing(options: WindowedAudioProcessingOptions): boolean {
  return (
    options.hasAudioContent &&
    options.durationSeconds >= WINDOWED_AUDIO_MIN_DURATION_SECONDS &&
    options.supportsWindowedProcessing()
  )
}

/**
 * Structured fields for the start-of-render log line. Reporters (and the
 * headless harness) key off these to spot an export that renders an empty or
 * animation-free timeline, so they are derived in one place.
 */
export interface RenderStartSummary {
  tracksCount: number
  hasTransitions: boolean
  hasKeyframes: boolean
}

export function summarizeCompositionForRender(
  composition: CompositionInputProps,
): RenderStartSummary {
  return {
    tracksCount: composition.tracks?.length ?? 0,
    hasTransitions: (composition.transitions?.length ?? 0) > 0,
    hasKeyframes: (composition.keyframes?.length ?? 0) > 0,
  }
}

export interface RenderScalePlan {
  /** Composition (project) resolution — what the renderer draws at. */
  compositionWidth: number
  compositionHeight: number
  /** Export resolution — what the encoder receives. */
  exportWidth: number
  exportHeight: number
  /** Export resolution differs from the composition, so frames must be scaled. */
  needsScaling: boolean
}

export function resolveRenderScalePlan(
  compositionInput: CompositionInputProps,
  exportResolution: ClientExportSettings['resolution'],
): RenderScalePlan {
  // Get composition (project) resolution – this is what we render at
  const compositionWidth = compositionInput.width ?? exportResolution.width
  const compositionHeight = compositionInput.height ?? exportResolution.height

  // Export resolution – this is what we output (may be different from composition)
  const exportWidth = exportResolution.width
  const exportHeight = exportResolution.height

  return {
    compositionWidth,
    compositionHeight,
    exportWidth,
    exportHeight,
    needsScaling: exportWidth !== compositionWidth || exportHeight !== compositionHeight,
  }
}

export interface TranscriptSubtitleExportPlan {
  /** Mux the transcript as a soft WebVTT track. */
  embedTranscriptSubtitles: boolean
  /** `embedded` was requested but can't be honoured — burning in instead. */
  fallbackToBurnIn: boolean
  /** Payload for the soft track; null when the mode isn't `embedded` or it's empty. */
  transcriptSubtitleVtt: string | null
  /** Composition to render — transcript items are kept only when burning in. */
  renderCompositionInput: CompositionInputProps
}

/**
 * Resolve the subtitle export matrix up front: the soft-embed decision (see
 * {@link resolveSubtitleExportPlan}), the VTT payload to mux, and the
 * composition the frame renderer must consume.
 */
export function resolveTranscriptSubtitleExport(options: {
  composition: CompositionInputProps
  subtitleMode: SubtitleExportMode | undefined
  container: ClientContainer
  supportsWebVttSubtitles: boolean
}): TranscriptSubtitleExportPlan {
  const subtitleMode: SubtitleExportMode = options.subtitleMode ?? 'burn'
  const transcriptSubtitleVtt =
    subtitleMode === 'embedded' ? buildTranscriptSubtitleWebVtt(options.composition) : null
  const { embedTranscriptSubtitles, burnInSubtitles, fallbackToBurnIn } = resolveSubtitleExportPlan(
    {
      subtitleMode,
      container: options.container,
      supportsWebVttSubtitles: options.supportsWebVttSubtitles,
      hasTranscriptVtt: transcriptSubtitleVtt !== null,
    },
  )

  return {
    embedTranscriptSubtitles,
    fallbackToBurnIn,
    transcriptSubtitleVtt,
    renderCompositionInput: burnInSubtitles
      ? options.composition
      : omitTranscriptSubtitleItemsForSoftSubtitleExport(options.composition),
  }
}

/**
 * Audio codec the muxer will encode alongside the video track. Audio-only
 * containers have no video path, so a container without an encodable codec is
 * rejected here instead of silently exporting a video with no audio.
 */
export function resolveMuxedAudioCodec(container: ClientContainer): 'aac' | 'opus' {
  const audioCodec = getDefaultAudioCodec(container)
  if (audioCodec !== 'aac' && audioCodec !== 'opus') {
    throw new Error(`Unsupported audio codec ${audioCodec} for ${container.toUpperCase()} export`)
  }
  return audioCodec
}

/**
 * Audio codec for an audio-only export: MP3/AAC are encoded, everything else
 * (WAV) is written as uncompressed PCM.
 */
export function resolveAudioOnlyCodec(container: ClientContainer): 'mp3' | 'aac' | 'pcm-s16' {
  if (container === 'mp3') return 'mp3'
  if (container === 'aac') return 'aac'
  return 'pcm-s16'
}
