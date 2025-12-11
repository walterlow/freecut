import type { AnimatableProperty, EasingType, EasingConfig } from './keyframe';

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  thumbnail?: string; // Data URL of project thumbnail (from playhead)
  thumbnailUrl?: string; // External URL (deprecated, use thumbnail)
  metadata: ProjectResolution;
  timeline?: ProjectTimeline;
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
  }>;
  items: Array<{
    id: string;
    trackId: string;
    from: number;
    durationInFrames: number;
    label: string;
    mediaId?: string;
    originId?: string; // Tracks lineage for stable React keys
    type: 'video' | 'audio' | 'text' | 'image' | 'shape';
    // Type-specific fields stored as optional for flexibility
    src?: string;
    thumbnailUrl?: string;
    offset?: number;
    waveformData?: number[];
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

export interface ProjectFormData {
  name: string;
  description: string;
  metadata: ProjectResolution;
}
