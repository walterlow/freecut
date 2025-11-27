export interface MediaMetadata {
  id: string;
  contentHash: string; // SHA-256 hash of file content for deduplication
  opfsPath: string; // Derived from contentHash: content/{hash[0:2]}/{hash[2:4]}/{hash}/data
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  thumbnailId?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// Content record for reference counting in content-addressable storage
export interface ContentRecord {
  hash: string; // SHA-256 hash (primary key)
  fileSize: number;
  mimeType: string;
  referenceCount: number; // Number of media entries referencing this content
  createdAt: number;
}

// Project-media association for per-project media isolation
export interface ProjectMediaAssociation {
  projectId: string;
  mediaId: string;
  addedAt: number;
}

export interface ProjectMetadata {
  id: string;
  name: string;
  description: string;
  duration: number;
  resolution: { width: number; height: number };
  fps: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThumbnailData {
  id: string;
  mediaId: string;
  blob: Blob;
  timestamp: number;
  width: number;
  height: number;
}

// Density tier for filmstrip thumbnails
export type FilmstripDensity = 'low' | 'medium' | 'high';

// Filmstrip data for timeline video clip thumbnails
export interface FilmstripData {
  id: string; // Format: `${mediaId}:${density}`
  mediaId: string;
  density: FilmstripDensity;
  frames: Blob[]; // JPEG blobs for each frame
  timestamps: number[]; // Frame timestamps in seconds
  width: number; // Thumbnail width in pixels
  height: number; // Thumbnail height in pixels
  createdAt: number;
}

// Waveform data for timeline audio clip visualization
export interface WaveformData {
  id: string; // Same as mediaId
  mediaId: string;
  peaks: ArrayBuffer; // Float32Array as ArrayBuffer (normalized 0-1)
  duration: number; // Audio duration in seconds
  sampleRate: number; // Samples per second in peaks data
  channels: number; // Number of audio channels
  createdAt: number;
}
