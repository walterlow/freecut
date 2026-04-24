export type FontWeight = 'normal' | 'medium' | 'semibold' | 'bold';
export type FontStyle = 'normal' | 'italic';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export type ShapeType =
  | 'rectangle'
  | 'circle'
  | 'triangle'
  | 'ellipse'
  | 'star'
  | 'polygon'
  | 'heart';

export type ItemType =
  | 'video'
  | 'audio'
  | 'text'
  | 'image'
  | 'shape'
  | 'adjustment'
  | 'composition';

export interface Transform {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  anchorX?: number;
  anchorY?: number;
  rotation?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  opacity?: number;
  cornerRadius?: number;
  aspectRatioLocked?: boolean;
}

export interface Crop {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  softness?: number;
}

export interface TextShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
}

export interface TextStroke {
  width: number;
  color: string;
}

export interface GpuEffect {
  type: 'gpu-effect';
  gpuEffectType: string;
  params: Record<string, number | boolean | string>;
}

export interface ItemEffect {
  id: string;
  enabled: boolean;
  effect: GpuEffect;
}

export interface TimelineItemBase {
  id: string;
  trackId: string;
  from: number;
  durationInFrames: number;
  label: string;
  mediaId?: string;
  sourceStart?: number;
  sourceEnd?: number;
  sourceDuration?: number;
  sourceFps?: number;
  speed?: number;
  transform?: Transform;
  crop?: Crop;
  effects?: ItemEffect[];
  blendMode?: string;
  volume?: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface VideoItem extends TimelineItemBase {
  type: 'video';
  src?: string;
  thumbnailUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface AudioItem extends TimelineItemBase {
  type: 'audio';
  src?: string;
}

export interface ImageItem extends TimelineItemBase {
  type: 'image';
  src?: string;
  thumbnailUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface TextItem extends TimelineItemBase {
  type: 'text';
  text: string;
  color: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: FontWeight;
  fontStyle?: FontStyle;
  underline?: boolean;
  backgroundColor?: string;
  backgroundRadius?: number;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  lineHeight?: number;
  letterSpacing?: number;
  textPadding?: number;
  textShadow?: TextShadow;
  stroke?: TextStroke;
}

export interface ShapeItem extends TimelineItemBase {
  type: 'shape';
  shapeType: ShapeType;
  fillColor: string;
  strokeColor?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  points?: number;
  innerRadius?: number;
}

export interface AdjustmentItem extends TimelineItemBase {
  type: 'adjustment';
  effectOpacity?: number;
}

export type TimelineItem =
  | VideoItem
  | AudioItem
  | ImageItem
  | TextItem
  | ShapeItem
  | AdjustmentItem;

export interface Track {
  id: string;
  name: string;
  kind?: 'video' | 'audio';
  height: number;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  solo: boolean;
  volume?: number;
  color?: string;
  order: number;
  parentTrackId?: string;
  isGroup?: boolean;
  isCollapsed?: boolean;
}

export interface Transition {
  id: string;
  type: 'crossfade';
  leftClipId: string;
  rightClipId: string;
  trackId: string;
  durationInFrames: number;
  presetId?: string;
  alignment?: number;
  properties?: Record<string, unknown>;
}

export interface Marker {
  id: string;
  frame: number;
  label?: string;
  color: string;
}

export interface ProjectResolution {
  width: number;
  height: number;
  fps: number;
  backgroundColor?: string;
}

export interface Timeline {
  tracks: Track[];
  items: TimelineItem[];
  transitions?: Transition[];
  markers?: Marker[];
  currentFrame?: number;
  inPoint?: number;
  outPoint?: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  schemaVersion?: number;
  metadata: ProjectResolution;
  timeline?: Timeline;
}

export interface MediaReference {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  contentHash?: string;
}
