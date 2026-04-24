/**
 * Pure-data project types for the FreeCut SDK.
 *
 * This is deliberately a *subset* of the fields the FreeCut editor
 * understands. Output matches the `ProjectSnapshot` JSON format so the
 * editor's JSON import service can round-trip it without changes.
 *
 * Zero runtime dependencies — safe to use in Node, Deno, Bun, browsers,
 * edge runtimes, and agent sandboxes.
 */

import type { ProjectSnapshot as CoreProjectSnapshot } from '@freecut/core';

export const SDK_VERSION = '0.0.1';
export const SNAPSHOT_VERSION = '1.0';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/**
 * A GPU effect entry. `gpuEffectType` matches the ids registered in
 * `src/lib/gpu-effects/effects/*` (e.g. 'gaussian-blur', 'vignette',
 * 'halftone'). Params are shader uniforms — shape depends on the effect.
 */
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

// ---------------------------------------------------------------------------
// Timeline items
// ---------------------------------------------------------------------------

interface BaseItem {
  id: string;
  trackId: string;
  /** Start frame on the project timeline (project fps). */
  from: number;
  /** Duration on the project timeline, in project-fps frames. */
  durationInFrames: number;
  label: string;
  /** Optional reference to a media asset by id. Agents typically set this. */
  mediaId?: string;
  /** Trim into the source, in source-fps frames. */
  sourceStart?: number;
  sourceEnd?: number;
  sourceDuration?: number;
  sourceFps?: number;
  speed?: number;
  transform?: Transform;
  crop?: Crop;
  effects?: ItemEffect[];
  blendMode?: string;
  // Audio
  volume?: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  // Video
  fadeIn?: number;
  fadeOut?: number;
}

export interface VideoItem extends BaseItem {
  type: 'video';
  src?: string;
  thumbnailUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface AudioItem extends BaseItem {
  type: 'audio';
  src?: string;
}

export interface ImageItem extends BaseItem {
  type: 'image';
  src?: string;
  thumbnailUrl?: string;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface TextItem extends BaseItem {
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

export interface ShapeItem extends BaseItem {
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

export interface AdjustmentItem extends BaseItem {
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

// ---------------------------------------------------------------------------
// Tracks, transitions, markers
// ---------------------------------------------------------------------------

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

/**
 * Cross-clip transition. `presetId` picks the renderer (see
 * `domain/timeline/transitions/renderers/*` — fade, wipe, slide, flip,
 * clockWipe, iris, dissolve, sparkles, glitch, lightLeak, pixelate,
 * chromatic, radialBlur).
 */
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

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

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
  /** Duration in seconds, usually derived from the last clip's end. */
  duration: number;
  schemaVersion?: number;
  metadata: ProjectResolution;
  timeline?: Timeline;
}

// ---------------------------------------------------------------------------
// Media reference (metadata only — no file content)
// ---------------------------------------------------------------------------

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
  /** Content hash so the editor can match the media on the target workspace. */
  contentHash?: string;
}

/**
 * On-disk format written by `serialize()`. Mirrors the editor's
 * `ProjectSnapshot` so the JSON import service accepts it unchanged.
 */
export type ProjectSnapshot = CoreProjectSnapshot<Project, MediaReference>;
