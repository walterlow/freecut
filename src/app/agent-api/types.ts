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
}

export type AgentSubscriber = (event: { type: 'change' }) => void;
