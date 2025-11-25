// Base type for all timeline items (following Remotion pattern)
type BaseTimelineItem = {
  id: string;
  trackId: string;
  from: number; // Start frame (Remotion convention)
  durationInFrames: number; // Duration in frames (Remotion convention)
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
};

// Discriminated union types for different item types
export type VideoItem = BaseTimelineItem & {
  type: 'video';
  src: string;
  thumbnailUrl?: string;
  offset?: number; // Trim offset in source video
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
  fontSize?: number;
  fontFamily?: string;
  color: string;
};

export type ImageItem = BaseTimelineItem & {
  type: 'image';
  src: string;
  thumbnailUrl?: string;
};

export type ShapeItem = BaseTimelineItem & {
  type: 'shape';
  shapeType: 'rectangle' | 'circle' | 'triangle' | 'solid';
  fillColor: string;
};

// Union type for all timeline items
export type TimelineItem = VideoItem | AudioItem | TextItem | ImageItem | ShapeItem;

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

export interface Marker {
  time: number;
  position: number;
  label: string;
  major: boolean;
}
