/**
 * JSON-serializable input/output types for the agent API. These mirror
 * @freecut/sdk's public types so a snapshot authored by the SDK can be
 * loaded here and vice versa. Kept separate from the live timeline
 * types so the surface stays stable as internals evolve.
 */

export type AgentItemType =
  | 'video'
  | 'audio'
  | 'text'
  | 'image'
  | 'shape'
  | 'adjustment'
  | 'composition';

export interface AgentTransform {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  anchorX?: number;
  anchorY?: number;
  rotation?: number;
  opacity?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}

export interface AgentGpuEffect {
  type: 'gpu-effect';
  gpuEffectType: string;
  params: Record<string, number | boolean | string>;
}

export interface AgentAddItemBase {
  trackId: string;
  from: number;
  durationInFrames: number;
  label?: string;
  mediaId?: string;
  transform?: AgentTransform;
}

export type AgentAddItem =
  | (AgentAddItemBase & { type: 'video'; src?: string; sourceWidth?: number; sourceHeight?: number; volume?: number })
  | (AgentAddItemBase & { type: 'audio'; src?: string; volume?: number })
  | (AgentAddItemBase & { type: 'image'; src?: string; sourceWidth?: number; sourceHeight?: number })
  | (AgentAddItemBase & { type: 'text'; text: string; color?: string; fontSize?: number; fontFamily?: string })
  | (AgentAddItemBase & { type: 'shape'; shapeType: string; fillColor?: string; strokeColor?: string; strokeWidth?: number })
  | (AgentAddItemBase & { type: 'adjustment' });

export interface AgentTimelineItem {
  id: string;
  type: AgentItemType;
  trackId: string;
  from: number;
  durationInFrames: number;
  label?: string;
  mediaId?: string;
  effects?: Array<{ id: string; enabled: boolean; effect: AgentGpuEffect }>;
}

export interface AgentTrack {
  id: string;
  name: string;
  kind: 'video' | 'audio';
  order: number;
  locked: boolean;
  visible: boolean;
  muted: boolean;
  solo: boolean;
}

export interface AgentTransition {
  id: string;
  type: string;
  leftClipId: string;
  rightClipId: string;
  trackId: string;
  durationInFrames: number;
  presetId?: string;
}

export interface AgentMarker {
  id: string;
  frame: number;
  label?: string;
  color: string;
}

export interface AgentPlaybackState {
  currentFrame: number;
  isPlaying: boolean;
  /** Preview canvas zoom. 'auto' means fit-to-viewport; number is a percentage (1.0 = 100%). */
  previewZoom: 'auto' | number;
}

export interface AgentTimelineSnapshot {
  tracks: AgentTrack[];
  items: AgentTimelineItem[];
  transitions: AgentTransition[];
  markers: AgentMarker[];
  inPoint: number | null;
  outPoint: number | null;
}

export interface AgentRenderRange {
  /** Inclusive render start frame in project fps. */
  inFrame?: number;
  /** Exclusive render end frame in project fps. */
  outFrame?: number;
  /** Alias for inFrame. */
  startFrame?: number;
  /** Alias for outFrame. */
  endFrame?: number;
  /** Duration from the resolved start frame. */
  durationInFrames?: number;
  /** Start time in seconds; converted with project fps. */
  startSeconds?: number;
  /** End time in seconds; converted with project fps. */
  endSeconds?: number;
  /** Duration in seconds from the resolved start. */
  durationSeconds?: number;
}

export interface AgentRenderExportOptions {
  mode?: 'video' | 'audio';
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  codec?: 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1' | 'prores';
  videoContainer?: 'mp4' | 'mov' | 'webm' | 'mkv';
  audioContainer?: 'mp3' | 'aac' | 'wav';
  resolution?: { width: number; height: number };
  renderWholeProject?: boolean;
  /** Overrides timeline IO markers for this render without mutating the project. */
  range?: AgentRenderRange;
  /** Maximum binary payload returned over the agent bridge. Defaults to 128 MiB. */
  maxBytes?: number;
  /** Binary chunk size before base64 encoding. Defaults to 512 KiB. */
  chunkSize?: number;
}

export interface AgentRenderMediaSource {
  url: string;
  audioUrl?: string;
  keyframeTimestamps?: number[];
}

export interface AgentRenderProjectExportOptions extends AgentRenderExportOptions {
  /** Project JSON loaded by an external caller. Does not touch workspace storage. */
  project: unknown;
  /** Media id to browser-readable URL. Used instead of workspace/IndexedDB media resolution. */
  mediaSources?: Record<string, string | AgentRenderMediaSource>;
}

export interface AgentRenderExportResult {
  mimeType: string;
  duration: number;
  fileSize: number;
  extension: string;
  chunks: string[];
  chunkEncoding: 'base64';
}

export type AgentSubscriber = (event: { type: 'change' }) => void;
