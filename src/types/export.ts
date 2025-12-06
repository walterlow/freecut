import type { TimelineTrack } from './timeline';
import type { Transition } from './transition';

export interface ExportSettings {
  codec: 'h264' | 'h265' | 'vp8' | 'vp9' | 'prores';
  quality: 'low' | 'medium' | 'high' | 'ultra';
  resolution: { width: number; height: number };
  bitrate?: string;
  audioBitrate?: string;
  proResProfile?: 'proxy' | 'light' | 'standard' | 'hq' | '4444' | '4444-xq';
}

export interface RemotionInputProps {
  fps: number;
  durationInFrames?: number;
  width?: number;
  height?: number;
  tracks: TimelineTrack[];
  transitions?: Transition[]; // Transitions between clips
  backgroundColor?: string; // Hex color for canvas background
}
