import type { AnimatableProperty, EasingType, EasingConfig } from './keyframe';

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
  thumbnailUrl?: string; // @deprecated External URL
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
  tracks: Array<{
    id: string;
    name: string;
    height: number;
    locked: boolean;
    visible: boolean;
    muted: boolean;
    solo: boolean;
    color?: string;
    order: number;
    parentTrackId?: string;
    isGroup?: boolean;
    isCollapsed?: boolean;
  }>;
  items: Array<{
    id: string;
    trackId: string;
    from: number;
    durationInFrames: number;
    label: string;
    mediaId?: string;
    originId?: string; // Tracks lineage for stable React keys
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
    text?: string;
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
    // Audio properties
    volume?: number;
    audioFadeIn?: number;
    audioFadeOut?: number;
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
  transitions?: Array<{
    id: string;
    type: 'crossfade';
    leftClipId: string;
    rightClipId: string;
    trackId: string;
    durationInFrames: number;
    presentation?: string;
    timing?: string;
    direction?: string;
    alignment?: number;
    bezierPoints?: { x1: number; y1: number; x2: number; y2: number };
    presetId?: string;
  }>;
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
