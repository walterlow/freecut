import type { ExportSettings } from '../src/types/export.js';
import type { TimelineTrack } from '../src/types/timeline.js';

export interface RenderRequest {
  jobId: string;
  composition: {
    fps: number;
    durationInFrames: number;
    width: number;
    height: number;
    tracks: TimelineTrack[];
  };
  settings: ExportSettings;
  mediaFiles: string[]; // List of media IDs that need to be uploaded
}

export interface RenderJob {
  jobId: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  renderedFrames?: number;
  totalFrames?: number;
  error?: string;
  outputPath?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface RenderProgress {
  jobId: string;
  progress: number;
  renderedFrames: number;
  totalFrames: number;
  status: RenderJob['status'];
}

export interface MediaUpload {
  mediaId: string;
  file: Buffer;
  filename: string;
  mimetype: string;
}
