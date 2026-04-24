import type {
  MediaReference,
  Project,
  ProjectSnapshot as CoreProjectSnapshot,
} from '@freecut/core';

export const SDK_VERSION = '0.0.1';
export const SNAPSHOT_VERSION = '1.0';

export type {
  AdjustmentItem,
  AudioItem,
  Crop,
  FontStyle,
  FontWeight,
  GpuEffect,
  ImageItem,
  ItemEffect,
  ItemType,
  Marker,
  MediaReference,
  Project,
  ProjectResolution,
  ShapeItem,
  ShapeType,
  TextAlign,
  TextItem,
  TextShadow,
  TextStroke,
  Timeline,
  TimelineItem,
  Track,
  Transform,
  Transition,
  VerticalAlign,
  VideoItem,
} from '@freecut/core';

export type ProjectSnapshot = CoreProjectSnapshot<Project, MediaReference>;
