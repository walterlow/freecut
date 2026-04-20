import type { AnimatableProperty, EasingType, EasingConfig } from './keyframe';
import type { AudioEqSettings } from './audio';
import type { Transition } from './transition';
import type { CropSettings } from './transform';

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  /**
   * Schema version for migrations. Projects without this field are version 1.
   * Increment CURRENT_SCHEMA_VERSION in lib/migrations when adding migrations.
   */
  schemaVersion?: number;
  thumbnailId?: string; // Reference to ThumbnailData in IndexedDB
  thumbnail?: string; // @deprecated Base64 data URL (for backward compatibility)
  metadata: ProjectResolution;
  timeline?: ProjectTimeline;
  /**
   * Root folder handle for the project's media files.
   * Set when importing a bundle or manually by the user.
   * Used for smarter relinking and showing relative paths.
   */
  rootFolderHandle?: FileSystemDirectoryHandle;
  /**
   * Display name for the root folder (since handles don't expose full paths).
   * Updated when rootFolderHandle is set.
   */
  rootFolderName?: string;
}

export interface ProjectTimeline {
  /**
   * Master bus gain in dB applied after all track-level volume/fade math but
   * before the per-device monitor gain. Stored with the project so exports
   * and cross-device previews see the same audible level. Defaults to 0
   * (unity) when absent.
   */
  masterBusDb?: number;
  tracks: Array<{
    id: string;
    name: string;
    kind?: 'video' | 'audio';
    height: number;
    locked: boolean;
    syncLock?: boolean;
    visible: boolean;
    muted: boolean;
    solo: boolean;
    volume?: number;
    audioEq?: AudioEqSettings;
    color?: string;
    order: number;
    parentTrackId?: string;
    isGroup?: boolean;
    isCollapsed?: boolean;
  }>;
  busAudioEq?: AudioEqSettings;
  items: Array<{
    id: string;
    trackId: string;
    from: number;
    durationInFrames: number;
    label: string;
    mediaId?: string;
    originId?: string; // Tracks lineage for stable React keys
    linkedGroupId?: string;
    type: 'video' | 'audio' | 'text' | 'image' | 'shape' | 'composition' | 'adjustment';
    // Type-specific fields stored as optional for flexibility
    src?: string;
    thumbnailUrl?: string;
    offset?: number; // @deprecated Use sourceStart instead
    waveformData?: number[];
    // Source boundaries for media items (video/audio)
    sourceStart?: number; // Start position in source media (frames)
    sourceEnd?: number; // End position in source media (frames)
    sourceDuration?: number; // Total duration of source media (frames)
    sourceFps?: number; // Source media frame rate for source* frame fields
    text?: string;
    captionSource?: {
      type: 'transcript';
      clipId: string;
      mediaId: string;
    };
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    shapeType?: 'rectangle' | 'circle' | 'triangle' | 'ellipse' | 'star' | 'polygon';
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    direction?: 'up' | 'down' | 'left' | 'right';
    points?: number;
    innerRadius?: number;
    speed?: number; // Playback speed multiplier (default 1.0)
    // Composition item fields
    compositionId?: string; // Reference to a sub-composition
    compositionWidth?: number;
    compositionHeight?: number;
    // Source dimensions (for video/image items)
    sourceWidth?: number;
    sourceHeight?: number;
    // Transform properties
    transform?: {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      rotation?: number;
      opacity?: number;
      cornerRadius?: number;
      aspectRatioLocked?: boolean;
    };
    crop?: CropSettings;
    // Audio properties
    volume?: number;
    audioFadeIn?: number;
    audioFadeOut?: number;
    audioFadeInCurve?: number;
    audioFadeOutCurve?: number;
    audioFadeInCurveX?: number;
    audioFadeOutCurveX?: number;
    audioPitchSemitones?: number;
    audioPitchCents?: number;
    audioEqOutputGainDb?: number;
    audioEqBand1Enabled?: boolean;
    audioEqBand1Type?: import('./audio').AudioEqBand1Type;
    audioEqBand1FrequencyHz?: number;
    audioEqBand1GainDb?: number;
    audioEqBand1Q?: number;
    audioEqBand1SlopeDbPerOct?: 6 | 12 | 18 | 24;
    audioEqLowCutEnabled?: boolean;
    audioEqLowCutFrequencyHz?: number;
    audioEqLowCutSlopeDbPerOct?: 6 | 12 | 18 | 24;
    audioEqLowEnabled?: boolean;
    audioEqLowType?: import('./audio').AudioEqInnerBandType;
    audioEqLowGainDb?: number;
    audioEqLowFrequencyHz?: number;
    audioEqLowQ?: number;
    audioEqLowMidEnabled?: boolean;
    audioEqLowMidType?: import('./audio').AudioEqInnerBandType;
    audioEqLowMidGainDb?: number;
    audioEqLowMidFrequencyHz?: number;
    audioEqLowMidQ?: number;
    audioEqMidGainDb?: number;
    audioEqHighMidEnabled?: boolean;
    audioEqHighMidType?: import('./audio').AudioEqInnerBandType;
    audioEqHighMidGainDb?: number;
    audioEqHighMidFrequencyHz?: number;
    audioEqHighMidQ?: number;
    audioEqHighEnabled?: boolean;
    audioEqHighType?: import('./audio').AudioEqInnerBandType;
    audioEqHighGainDb?: number;
    audioEqHighFrequencyHz?: number;
    audioEqHighQ?: number;
    audioEqBand6Enabled?: boolean;
    audioEqBand6Type?: import('./audio').AudioEqBand6Type;
    audioEqBand6FrequencyHz?: number;
    audioEqBand6GainDb?: number;
    audioEqBand6Q?: number;
    audioEqBand6SlopeDbPerOct?: 6 | 12 | 18 | 24;
    audioEqHighCutEnabled?: boolean;
    audioEqHighCutFrequencyHz?: number;
    audioEqHighCutSlopeDbPerOct?: 6 | 12 | 18 | 24;
    // Video properties
    fadeIn?: number;
    fadeOut?: number;
  }>;
  // Playback and view state
  currentFrame?: number;
  zoomLevel?: number;
  scrollPosition?: number;
  // In/Out markers
  inPoint?: number;
  outPoint?: number;
  // Project markers
  markers?: Array<{
    id: string;
    frame: number;
    label?: string;
    color: string;
  }>;
  // Transitions between clips
  transitions?: Transition[];
  // Sub-compositions (pre-comps)
  compositions?: Array<{
    id: string;
    name: string;
    items: ProjectTimeline['items'];
    tracks: ProjectTimeline['tracks'];
    transitions?: ProjectTimeline['transitions'];
    keyframes?: ProjectTimeline['keyframes'];
    fps: number;
    width: number;
    height: number;
    durationInFrames: number;
    backgroundColor?: string;
    busAudioEq?: AudioEqSettings;
  }>;
  // Keyframe animations
  keyframes?: Array<{
    itemId: string;
    properties: Array<{
      property: AnimatableProperty;
      keyframes: Array<{
        id: string;
        frame: number;
        value: number;
        easing: EasingType;
        easingConfig?: EasingConfig;
      }>;
    }>;
  }>;
}

export interface ProjectResolution {
  width: number;
  height: number;
  fps: number;
  backgroundColor?: string; // Hex color, defaults to #000000
}
