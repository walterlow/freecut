import type { AudioEqSettings } from './audio'
import type { TimelineTrack } from './timeline'
import type { Transition } from './transition'
import type { ItemKeyframes } from './keyframe'

// Export modes
export type ExportMode = 'video' | 'audio'

// Container formats
export type VideoContainer = 'mp4' | 'mov' | 'webm' | 'mkv'
export type AudioContainer = 'mp3' | 'aac' | 'wav'

/**
 * How timeline transcript subtitles are handled on export:
 * - `off`: no captions in the output.
 * - `burn`: rendered into the video frames (hardsub) — universal.
 * - `sidecar`: clean video + a separate `.srt` file downloaded alongside.
 * - `embedded`: soft, toggleable subtitle track. Only usable for containers
 *   whose muxer supports it (WebM/MKV); MP4/MOV can't (mediabunny WebVTT bug +
 *   poor player support), so the dialog doesn't offer it there.
 */
export type SubtitleExportMode = 'off' | 'burn' | 'sidecar' | 'embedded'

export interface ExportSettings {
  codec: 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1' | 'prores'
  quality: 'low' | 'medium' | 'high' | 'ultra'
  resolution: { width: number; height: number }
  bitrate?: string
  audioBitrate?: string
  proResProfile?: 'proxy' | 'light' | 'standard' | 'hq' | '4444' | '4444-xq'
}

/**
 * Extended export settings for client-side rendering
 * Includes container format and export mode options
 */
export interface ExtendedExportSettings extends ExportSettings {
  mode: ExportMode
  videoContainer?: VideoContainer
  audioContainer?: AudioContainer
  /** How timeline transcript subtitles are handled (defaults to `burn`). */
  subtitleMode?: SubtitleExportMode
  /** When true, ignores in/out points and exports the full timeline */
  renderWholeProject?: boolean
}

export interface CompositionInputProps {
  fps: number
  durationInFrames?: number
  width?: number
  height?: number
  tracks: TimelineTrack[]
  transitions?: Transition[] // Transitions between clips
  backgroundColor?: string // Hex color for canvas background
  keyframes?: ItemKeyframes[] // Keyframe animations for items
  busAudioEq?: AudioEqSettings
  /** Project-scoped master bus gain in dB (0 = unity). Applied to final mix. */
  masterBusDb?: number
}
