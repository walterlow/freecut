import type { TransformProperties } from './transform';
import type { ItemEffect } from './effects';

// Base type for all timeline items (following Composition pattern)
type BaseTimelineItem = {
  id: string;
  trackId: string;
  from: number; // Start frame (Composition convention)
  durationInFrames: number; // Duration in frames (Composition convention)
  label: string;
  mediaId?: string;
  originId?: string; // Tracks lineage - items from same split share this for stable React keys
  // Trim properties for media items
  trimStart?: number; // Frames trimmed from start of source media
  trimEnd?: number; // Frames trimmed from end of source media
  sourceStart?: number; // Original start frame in source media (default 0)
  sourceEnd?: number; // Original end frame in source media (default sourceDuration)
  sourceDuration?: number; // Total duration of source media in frames (for boundary checks)
  speed?: number; // Playback speed multiplier (default 1.0, range 0.1-10.0)
  // Transform properties (optional - defaults computed at render time)
  transform?: TransformProperties;
  // Audio properties (for video/audio items)
  volume?: number; // Volume in dB, -60 to +12 (default: 0)
  audioFadeIn?: number; // Audio fade in duration in seconds (default: 0)
  audioFadeOut?: number; // Audio fade out duration in seconds (default: 0)
  // Video properties (for video items)
  fadeIn?: number; // Video fade in duration in seconds (default: 0)
  fadeOut?: number; // Video fade out duration in seconds (default: 0)
  // Visual effects (CSS filters, glitch effects)
  effects?: ItemEffect[];
};

// Discriminated union types for different item types
export type VideoItem = BaseTimelineItem & {
  type: 'video';
  src: string;
  thumbnailUrl?: string;
  offset?: number; // Trim offset in source video
  // Source dimensions (intrinsic size from media metadata)
  sourceWidth?: number;
  sourceHeight?: number;
};

export type AudioItem = BaseTimelineItem & {
  type: 'audio';
  src: string;
  waveformData?: number[];
  offset?: number; // Trim offset in source audio
};

export type TextItem = BaseTimelineItem & {
  type: 'text';
  text: string;
  // Typography
  fontSize?: number; // Font size in pixels (default: 60)
  fontFamily?: string; // Font family name (default: 'Inter')
  fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold'; // Font weight (default: 'normal')
  fontStyle?: 'normal' | 'italic'; // Font style (default: 'normal')
  // Colors
  color: string; // Text color (hex or oklch)
  backgroundColor?: string; // Background color behind text (optional)
  // Text layout
  textAlign?: 'left' | 'center' | 'right'; // Horizontal alignment (default: 'center')
  verticalAlign?: 'top' | 'middle' | 'bottom'; // Vertical alignment (default: 'middle')
  lineHeight?: number; // Line height multiplier (default: 1.2)
  letterSpacing?: number; // Letter spacing in pixels (default: 0)
  // Text effects
  textShadow?: {
    offsetX: number;
    offsetY: number;
    blur: number;
    color: string;
  };
  stroke?: {
    width: number;
    color: string;
  };
};

export type ImageItem = BaseTimelineItem & {
  type: 'image';
  src: string;
  thumbnailUrl?: string;
  // Source dimensions (intrinsic size from media metadata)
  sourceWidth?: number;
  sourceHeight?: number;
};

export type ShapeType = 'rectangle' | 'circle' | 'triangle' | 'ellipse' | 'star' | 'polygon' | 'heart';

export type ShapeItem = BaseTimelineItem & {
  type: 'shape';
  shapeType: ShapeType;
  // Fill
  fillColor: string;
  // Stroke
  strokeColor?: string;
  strokeWidth?: number;
  // Shape-specific
  cornerRadius?: number;        // Rect, Triangle, Star, Polygon
  direction?: 'up' | 'down' | 'left' | 'right';  // Triangle only
  points?: number;              // Star (5 default), Polygon (6 default)
  innerRadius?: number;         // Star only (ratio 0-1 of outer)
  // Mask properties
  isMask?: boolean;             // When true, shape acts as mask for lower tracks
  maskType?: 'clip' | 'alpha';  // clip = hard edges, alpha = soft edges
  maskFeather?: number;         // Feather amount for alpha masks (0-100px, default: 10)
  maskInvert?: boolean;         // Invert mask (show outside, hide inside)
};

// Adjustment layer - applies effects to all items on tracks ABOVE this track
export type AdjustmentItem = BaseTimelineItem & {
  type: 'adjustment';
  // Uses existing effects?: ItemEffect[] from BaseTimelineItem
  // Effects apply to all items on tracks ABOVE this track (higher track order)

  // Optional: intensity control for all effects
  effectOpacity?: number; // 0-1, defaults to 1
};

// Union type for all timeline items
export type TimelineItem = VideoItem | AudioItem | TextItem | ImageItem | ShapeItem | AdjustmentItem;

export interface TimelineTrack {
  id: string;
  name: string;
  height: number;
  locked: boolean;
  visible: boolean; // Visual visibility (Eye icon)
  muted: boolean; // Audio muting (Volume icon)
  solo: boolean;
  color?: string; // Optional - tracks are generic containers, items have colors
  order: number;
  items: TimelineItem[];
}

export interface Gap {
  start: number;
  end: number;
  duration: number;
}

export interface SnapTarget {
  id: string;
  time: number;
  type: 'clip-start' | 'clip-end' | 'playhead' | 'marker';
  label?: string;
}

// Ruler tick markers (for time ruler display)
export interface RulerMarker {
  time: number;
  position: number;
  label: string;
  major: boolean;
}

// Project markers (user-created timeline markers)
export interface ProjectMarker {
  id: string;
  frame: number;
  label?: string;
  color: string;
}
