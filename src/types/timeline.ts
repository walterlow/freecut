import type { CropSettings, TransformParentBinding, TransformProperties } from './transform'
import type { ItemEffect } from './effects'
import type { MotionAnimationLayer, MotionModifier } from './motion'
import type { BlendMode } from './blend-modes'
import type { AudioEqSettings } from './audio'
import type { TextStylePresetId } from '@/shared/typography/text-style-preset-ids'
import type { TextMotionSpec } from './text-motion'
import type { TextLayoutDrafts, TextSpan, TextStyleFields } from './text'
import type { CompositionControlOverrides } from './composition-controls'
import type { Projection360Settings } from './projection360'

export interface TimelineItemCornerPin {
  topLeft: [number, number]
  topRight: [number, number]
  bottomRight: [number, number]
  bottomLeft: [number, number]
  referenceWidth?: number
  referenceHeight?: number
}

export interface TimelineTranscriptCaptionCue {
  id: string
  startSeconds: number
  endSeconds: number
  text: string
  words?: SubtitleCueWord[]
}

export type TimelineTranscriptCaptionStyle = TextStyleFields & {
  transform?: TransformProperties
}

export interface TimelineTranscriptCaptions {
  type: 'transcript'
  mediaId: string
  enabled: boolean
  updatedAt: number
  /** Version of the stored media transcript these cues were generated from. */
  sourceTranscriptUpdatedAt?: number
  /** Bump when transcript-to-caption phrase timing rules change. */
  timingVersion?: number
  /** Source-relative transcript cues. Render/export trims them to the clip. */
  cues: TimelineTranscriptCaptionCue[]
  style?: TimelineTranscriptCaptionStyle
}

/** Sidechain ducking settings carried by a duck-source item. */
export interface AudioDuckingSettings {
  /** Attenuation applied to other audio while this item is audible, in dB (<= 0). */
  duckOthersDb: number
  /** Ramp-down time into the duck, seconds (default 0.08). */
  attackSec?: number
  /** Ramp-up time out of the duck, seconds (default 0.25). */
  releaseSec?: number
  /** Restrict ducking to these tracks (default: all other audible tracks). */
  targetTrackIds?: string[]
}

// Base type for all timeline items (following Composition pattern)
type BaseTimelineItem = {
  id: string
  trackId: string
  from: number // Start frame (Composition convention)
  durationInFrames: number // Duration in frames (Composition convention)
  label: string
  mediaId?: string
  compositionId?: string // Reference to a sub-composition for compound wrappers
  originId?: string // Tracks lineage - items from same split share this for stable React keys
  linkedGroupId?: string // Links paired timeline items like synced video/audio companions
  // Trim properties for media items
  trimStart?: number // Frames trimmed from start of source media
  trimEnd?: number // Frames trimmed from end of source media
  sourceStart?: number // Original start frame in source media (default 0)
  sourceEnd?: number // Original end frame in source media (default sourceDuration)
  sourceDuration?: number // Total duration of source media in frames (for boundary checks)
  sourceFps?: number // Source media frame rate used for source* frame conversions
  speed?: number // Playback speed multiplier (default 1.0, range 0.1-10.0)
  isReversed?: boolean // Play media source range from end to start
  reverseConformSrc?: string // Full-res prepared reversed media blob URL for export
  reverseConformPath?: string // OPFS/workspace cache path for the full-res reversed media
  reverseConformKey?: string // Cache key describing the full-res reversed source range
  reverseConformPreviewSrc?: string // Proxy/preview prepared reversed media blob URL for smooth playback
  reverseConformPreviewPath?: string // OPFS/workspace cache path for the preview reversed media
  reverseConformPreviewKey?: string // Cache key describing the preview reversed source range
  reverseConformPreviewUsesProxy?: boolean // Whether the preview reversed media was generated from a proxy
  reverseConformPreviewIsSourceLevel?: boolean // Preview conform contains the entire reversed source
  reverseConformPreviewSourceDuration?: number // Source duration, in source-native frames, used by the conform
  reverseConformPreviewFps?: number // Frame rate of the source-level preview conform
  reverseConformStatus?: 'pending' | 'ready' | 'error'
  // Timeline-frame offset into reverseConform{Src,PreviewSrc} where this clip starts
  // playing. Set on split halves so they share the parent's conform but read
  // different ranges. Omit/0 = play from the start of the conform.
  reverseConformLocalStart?: number
  // Transform properties (optional - defaults computed at render time)
  transform?: TransformProperties
  // Optional bind-space parent. Missing on legacy and unparented items.
  transformParent?: TransformParentBinding
  // Source-relative media crop (normalized edge ratios)
  crop?: CropSettings
  // Audio properties (for video/audio items)
  volume?: number // Volume in dB, -60 to +12 (default: 0)
  audioFadeIn?: number // Audio fade in duration in seconds (default: 0)
  audioFadeOut?: number // Audio fade out duration in seconds (default: 0)
  audioFadeInCurve?: number // Audio fade in curve shape (-1..1, default: 0 linear)
  audioFadeOutCurve?: number // Audio fade out curve shape (-1..1, default: 0 linear)
  audioFadeInCurveX?: number // Audio fade in curve horizontal bias (0..1, default: ~0.52)
  audioFadeOutCurveX?: number // Audio fade out curve horizontal bias (0..1, default: ~0.52)
  audioPitchSemitones?: number // Clip pitch offset in semitones (-12..12)
  audioPitchCents?: number // Fine pitch offset in cents (-100..100)
  audioEqEnabled?: boolean // Master clip EQ on/off (default: true)
  audioEqOutputGainDb?: number // Post-EQ output trim in dB
  audioEqBand1Enabled?: boolean // Outer left EQ band on/off
  audioEqBand1Type?: import('@/types/audio').AudioEqBand1Type
  audioEqBand1FrequencyHz?: number
  audioEqBand1GainDb?: number
  audioEqBand1Q?: number
  audioEqBand1SlopeDbPerOct?: 6 | 12 | 18 | 24
  audioEqLowCutEnabled?: boolean // Enable low cut / high-pass filter
  audioEqLowCutFrequencyHz?: number // Low cut frequency in Hz
  audioEqLowCutSlopeDbPerOct?: 6 | 12 | 18 | 24 // Low cut slope
  audioEqLowEnabled?: boolean
  audioEqLowType?: import('@/types/audio').AudioEqInnerBandType
  audioEqLowGainDb?: number // Low shelf EQ gain in dB (default: 0)
  audioEqLowFrequencyHz?: number // Low shelf center frequency in Hz
  audioEqLowQ?: number // Low band Q for peak/notch/shelf shape
  audioEqLowMidEnabled?: boolean
  audioEqLowMidType?: import('@/types/audio').AudioEqInnerBandType
  audioEqLowMidGainDb?: number // Low-mid peaking EQ gain in dB (default: 0)
  audioEqLowMidFrequencyHz?: number // Low-mid center frequency in Hz
  audioEqLowMidQ?: number // Low-mid bandwidth/Q
  audioEqMidGainDb?: number // Legacy center band gain in dB (default: 0)
  audioEqHighMidEnabled?: boolean
  audioEqHighMidType?: import('@/types/audio').AudioEqInnerBandType
  audioEqHighMidGainDb?: number // High-mid peaking EQ gain in dB (default: 0)
  audioEqHighMidFrequencyHz?: number // High-mid center frequency in Hz
  audioEqHighMidQ?: number // High-mid bandwidth/Q
  audioEqHighEnabled?: boolean
  audioEqHighType?: import('@/types/audio').AudioEqInnerBandType
  audioEqHighGainDb?: number // High shelf EQ gain in dB (default: 0)
  audioEqHighFrequencyHz?: number // High shelf center frequency in Hz
  audioEqHighQ?: number // High band Q for peak/notch/shelf shape
  audioEqBand6Enabled?: boolean // Outer right EQ band on/off
  audioEqBand6Type?: import('@/types/audio').AudioEqBand6Type
  audioEqBand6FrequencyHz?: number
  audioEqBand6GainDb?: number
  audioEqBand6Q?: number
  audioEqBand6SlopeDbPerOct?: 6 | 12 | 18 | 24
  audioEqHighCutEnabled?: boolean // Enable high cut / low-pass filter
  audioEqHighCutFrequencyHz?: number // High cut frequency in Hz
  audioEqHighCutSlopeDbPerOct?: 6 | 12 | 18 | 24 // High cut slope
  /**
   * Sidechain ducking: while THIS item is audible, other audio in the mix is
   * attenuated by `duckOthersDb` with attack/release ramps. Scope with
   * `targetTrackIds` (default: every other audible track). The source itself
   * is never ducked by its own envelope.
   */
  audioDucking?: AudioDuckingSettings
  // Video properties (for video items)
  fadeIn?: number // Video fade in duration in seconds (default: 0)
  fadeOut?: number // Video fade out duration in seconds (default: 0)
  // Visual effects (GPU shader effects)
  effects?: ItemEffect[]
  // Procedural motion modifiers — continuous drift/breath/shake evaluated at
  // render time (no baked keyframes). See @/types/motion.
  motionModifiers?: MotionModifier[]
  // Named post-keyframe animation layers. Unlike Merge Keys, these remain
  // independently removable and preserve the underlying editable animation.
  motionLayers?: MotionAnimationLayer[]
  // Blend mode for layer compositing (default: 'normal')
  blendMode?: BlendMode
  // Corner pin transform (perspective warp)
  cornerPin?: TimelineItemCornerPin
  transcriptCaptions?: TimelineTranscriptCaptions
  // 360° Equirectangular Projection and FOV Options
  projection360?: Projection360Settings
}

export interface GeneratedCaptionSource {
  /**
   * `transcript` — generated from whisper speech-to-text segments.
   * `ai-captions` — generated from vision-language-model frame descriptions
   *   (e.g. LFM captioning). Distinguished so replace/remove flows can target
   *   one kind without disturbing the other on the same clip.
   * `subtitle-import` — imported from a sidecar subtitle file such as SRT/VTT.
   * `embedded-subtitles` — extracted from an embedded media subtitle track.
   */
  type: 'transcript' | 'ai-captions' | 'subtitle-import' | 'embedded-subtitles'
  clipId: string
  mediaId: string
  fileName?: string
  format?: 'srt' | 'vtt'
  importedAt?: number
}

// Discriminated union types for different item types
export type VideoItem = BaseTimelineItem & {
  type: 'video'
  src: string
  audioSrc?: string // Optional source used for audio playback when visuals use a silent proxy
  thumbnailUrl?: string
  offset?: number // Trim offset in source video
  embeddedAudioMuted?: boolean // Suppress embedded audio after unlinking from audio companion
  // Source dimensions (intrinsic size from media metadata)
  sourceWidth?: number
  sourceHeight?: number
}

export type AudioItem = BaseTimelineItem & {
  type: 'audio'
  src: string
  waveformData?: number[]
  offset?: number // Trim offset in source audio
}

export type { TextLayoutDrafts, TextSingleLayoutDraft, TextSpan } from './text'

export type TextItem = BaseTimelineItem &
  TextStyleFields & {
    type: 'text'
    text: string
    textSpans?: TextSpan[]
    /**
     * How `textSpans` flow: 'stack' (default) lays every span out as its own
     * line group; 'inline' concatenates spans into one wrapped text stream so
     * a span can recolor/underline words INSIDE a line (karaoke/keyword
     * accents). Inline flow uses the first span's font/size/letter-spacing for
     * the whole stream — per-span font/size differences are ignored there.
     */
    spanLayout?: 'stack' | 'inline'
    textLayoutDrafts?: TextLayoutDrafts
    textStylePresetId?: TextStylePresetId
    textStyleScale?: number
    /** Per-character/word/line animation (see src/types/text-motion.ts). */
    textMotion?: TextMotionSpec
    textRole?: 'caption'
    captionSource?: GeneratedCaptionSource
    color: string // Text color (hex or oklch)
  }

export type ImageItem = BaseTimelineItem & {
  type: 'image'
  src: string
  thumbnailUrl?: string
  // Source dimensions (intrinsic size from media metadata)
  sourceWidth?: number
  sourceHeight?: number
}

export type LottieItem = BaseTimelineItem & {
  type: 'lottie'
  src: string // blob URL to the Lottie JSON
  thumbnailUrl?: string
  // Source dimensions (intrinsic size from the animation's w/h)
  sourceWidth?: number
  sourceHeight?: number
  // Animation timing (from the Lottie's fr / op-ip), for timeline<->lottie frame mapping
  frameRate: number
  totalFrames: number
  // Loop the animation when the clip outlives one playthrough (default true)
  loop?: boolean
  // --- Editing controls (all optional; consumed by mapTimelineFrameToLottieFrame) ---
  // `speed` and `isReversed` are inherited from BaseTimelineItem but note: Lottie
  // uses a dedicated `reversed` flag so it never triggers video reverse-conform.
  /** Play the animation backward. */
  reversed?: boolean
  /** How the animation repeats while looping (default 'loop'). */
  loopMode?: 'loop' | 'pingpong'
  /** First source frame of the animation to play (default 0). */
  segmentStart?: number
  /** Last source frame of the animation to play (default totalFrames - 1). */
  segmentEnd?: number
  /**
   * Selected animation id for a multi-animation `.lottie` archive (default: the
   * manifest's primary animation). Switching this re-derives the clip's
   * timing/size from the chosen animation.
   */
  animationId?: string
  /**
   * Selected dotLottie theme id — a named rule set (from the `.lottie` manifest)
   * recoloring/retexting the animation's slots, applied via `setThemeData`.
   * Undefined renders the animation as authored.
   */
  themeId?: string
  /**
   * Per-layer text replacements for template Lotties, keyed by the text layer's
   * stable key (see `extractLottieTextLayers`). Applied before render to both
   * raw `.json` and `.lottie` archives (images inlined).
   */
  textOverrides?: Record<string, string>
  /**
   * Per-color solid fill/stroke replacements for template Lotties, keyed by the
   * color's stable ordinal key (see `extractLottieColorLayers`) with `#rrggbb`
   * hex values. Applied before render to both raw `.json` and `.lottie`
   * archives. Animated colors freeze to the chosen color; gradients are
   * recolored via themes/slots, not here.
   */
  colorOverrides?: Record<string, string>
  /**
   * Scalar/vector value-slot overrides keyed by slot id (see
   * `extractLottieValueSlots`): a number for a scalar slot, `[x, y]` for a
   * vector slot. Applied natively via dotlottie's slot setters after load.
   */
  slotOverrides?: Record<string, number | [number, number]>
}

export type ShapeType =
  | 'rectangle'
  | 'circle'
  | 'triangle'
  | 'ellipse'
  | 'star'
  | 'polygon'
  | 'heart'
  | 'path'

export interface ShapeStyleFields {
  // Fill
  fillColor: string
  fillEnabled?: boolean
  /** Solid remains the default for legacy projects. */
  fillType?: 'solid' | 'linear'
  /** First color of a two-stop linear fill. `fillColor` remains its legacy fallback. */
  gradientStartColor?: string
  /** Second color of a two-stop linear fill. */
  gradientEndColor?: string
  /** Linear fill direction in degrees. Zero runs left-to-right. */
  gradientAngle?: number
  // Stroke
  strokeColor?: string
  strokeWidth?: number
  strokeEnabled?: boolean
  strokeLineCap?: 'butt' | 'round' | 'square'
  strokeLineJoin?: 'miter' | 'round' | 'bevel'
  strokeMiterLimit?: number
  /** Percentage of the outline at which the visible stroke begins (0-100). */
  trimPathStart?: number
  /** Percentage of the outline at which the visible stroke ends (0-100). */
  trimPathEnd?: number
  /** Rotates the trimmed stroke around the outline, in degrees. */
  trimPathOffset?: number
  /** Stroke width at the beginning of the visible path, as a percentage. */
  taperStartWidth?: number
  /** Stroke width at the end of the visible path, as a percentage. */
  taperEndWidth?: number
  /** Percentage of the visible path used to blend from the start width. */
  taperStartLength?: number
  /** Percentage of the visible path used to blend toward the end width. */
  taperEndLength?: number
}

export type ShapeItem = BaseTimelineItem &
  ShapeStyleFields & {
    type: 'shape'
    shapeType: ShapeType
    // Shape-specific
    /**
     * Corner rounding baked into the shape's PATH geometry (Rect, Triangle,
     * Star, Polygon) — the stroke follows the rounded outline. Not the same
     * property as `transform.cornerRadius`, which clips an item's rendered
     * bounding box: setting THAT on a shape clips the box straight through
     * the stroke instead of rounding the outline. Round a shape here.
     */
    cornerRadius?: number
    direction?: 'up' | 'down' | 'left' | 'right' // Triangle only
    points?: number // Star (5 default), Polygon (6 default)
    innerRadius?: number // Star only (ratio 0-1 of outer)
    // Path shape (custom bezier path drawn with pen tool)
    pathVertices?: import('@/types/masks').MaskVertex[] // Normalized 0-1 vertices for 'path' shapeType
    /** Whether a custom path connects its final vertex back to its first. Legacy paths are closed. */
    pathClosed?: boolean
    // Mask properties
    isMask?: boolean // When true, shape acts as mask for lower tracks
    maskType?: 'clip' | 'alpha' // clip = hard edges, alpha = soft edges
    maskFeather?: number // Feather amount for alpha masks (0-100px, default: 10)
    maskOpacity?: number // Matte strength (0-100%, default: 100)
    maskInvert?: boolean // Invert mask (show outside, hide inside)
  }

// Adjustment layer - applies effects to all items on tracks ABOVE this track
export type AdjustmentItem = BaseTimelineItem & {
  type: 'adjustment'
  // Uses existing effects?: ItemEffect[] from BaseTimelineItem
  // Effects apply to all items on tracks ABOVE this track (higher track order)

  // Optional: intensity control for all effects
  effectOpacity?: number // 0-1, defaults to 1
}

/** Invisible, animatable Null Object; `controller` remains the persisted legacy discriminator. */
export type ControllerItem = BaseTimelineItem & {
  type: 'controller'
  controllerKind: 'null'
  transform: TransformProperties
}

// Composition item - references a sub-composition (pre-comp)
export type CompositionItem = BaseTimelineItem & {
  type: 'composition'
  compositionId: string // References a SubComposition in compositions-store
  /** Values customized on this instance of the reusable composition. */
  compositionControlOverrides?: CompositionControlOverrides
  // Dimensions of the sub-composition canvas
  compositionWidth: number
  compositionHeight: number
}

/**
 * A single cue inside a {@link SubtitleSegmentItem}. Times are seconds
 * relative to the segment's `from` (after speed scaling) — i.e. the same
 * model as imported SRT/VTT, so a cue payload survives `from` changes,
 * trims, and splits without rewriting timestamps.
 */
export interface SubtitleCueWord {
  word: string
  start: number
  end: number
  confidence?: number
}

export interface SubtitleSegmentCue {
  id: string
  startSeconds: number
  endSeconds: number
  text: string
  words?: SubtitleCueWord[]
}

export type CaptionAnimationStyle = 'none' | 'hormozi' | 'mrbeast' | 'karaoke' | 'bounce'

/**
 * One timeline item that owns an entire subtitle track's cues.
 *
 * Replaces the historical "one TextItem per cue" approach for
 * embedded-subtitle / SRT-import flows: instead of stamping out N
 * caption items, we get one segment that renders the active cue per
 * frame from `cues`, applying the segment's style block uniformly.
 *
 * Style fields mirror the subset of {@link TextItem}'s typography that
 * makes sense applied to all cues at once. Per-cue styling can be
 * layered on later via `cue.style?` if needed.
 */
export type SubtitleSegmentItem = BaseTimelineItem &
  TextStyleFields & {
    type: 'subtitle'
    /** Source-track origin (e.g. "Squid.Game.S02E01.mkv - en (Track 6)"). */
    sourceLabel?: string
    /** How the cues were obtained — drives replace/refresh affordances. */
    source: SubtitleSegmentSource
    /** Cue list, sorted by `startSeconds`. Times are segment-relative. */
    cues: SubtitleSegmentCue[]
    color: string
    captionAnimationStyle?: CaptionAnimationStyle
    captionHighlightColor?: string
  }

export type SubtitleSegmentSource =
  | {
      type: 'transcript'
      mediaId: string
      clipId: string
    }
  | {
      type: 'embedded-subtitles'
      mediaId: string
      clipId: string
      trackNumber: number
      language?: string
      trackName?: string
      codecId?: string
      importedAt: number
    }
  | {
      type: 'subtitle-import'
      fileName: string
      format: 'srt' | 'vtt'
      importedAt: number
    }

// Union type for all timeline items
export type TimelineItem =
  | VideoItem
  | AudioItem
  | TextItem
  | ImageItem
  | LottieItem
  | ShapeItem
  | AdjustmentItem
  | ControllerItem
  | CompositionItem
  | SubtitleSegmentItem

export interface TimelineTrack {
  id: string
  name: string
  kind?: 'video' | 'audio'
  height: number
  locked: boolean
  syncLock?: boolean // Defaults to true - controls whether ripple edits propagate to this track
  visible: boolean // Visual visibility (Eye icon)
  muted: boolean // Audio muting (Volume icon)
  solo: boolean
  volume?: number // Track gain in dB (default: 0)
  audioEq?: AudioEqSettings // Per-track EQ (separate from per-clip EQ)
  color?: string // Optional - tracks are generic containers, items have colors
  order: number
  items: TimelineItem[]
  // Track grouping (subsequences)
  parentTrackId?: string // ID of the Layer Group track this track belongs to
  isGroup?: boolean // true = organizational Layer Group (no items, only children)
  isCollapsed?: boolean // Whether the group's children are collapsed
}

// Project markers (user-created timeline markers)
export interface ProjectMarker {
  id: string
  frame: number
  /**
   * Usually empty — every surface falls back to an ordinal name via
   * `shared/timeline/marker-names`.
   */
  label?: string
  color: string
}
