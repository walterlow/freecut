// Base type for all timeline items (following Remotion pattern)
type BaseTimelineItem = {
  id: string;
  trackId: string;
  from: number; // Start frame (Remotion convention)
  durationInFrames: number; // Duration in frames (Remotion convention)
  label: string;
  mediaId?: string;
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
  muted: boolean;
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
