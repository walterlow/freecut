import type { DBSchema, IDBPDatabase } from 'idb';
import type { Project } from '@/types/project';
import type {
  MediaMetadata,
  ThumbnailData,
  ContentRecord,
  ProjectMediaAssociation,
  FilmstripData,
  WaveformRecord,
  GifFrameData,
  DecodedPreviewAudio,
} from '@/types/storage';

/**
 * Database schema definition for the video editor.
 * This file contains the schema types, constants, and migration logic.
 */

// Database schema
export interface VideoEditorDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: {
      name: string;
      updatedAt: number;
      createdAt: number;
    };
  };
  media: {
    key: string;
    value: MediaMetadata;
    indexes: {
      fileName: string;
      mimeType: string;
      createdAt: number;
      contentHash: string;
      storageType: string;
      tags: string;
    };
  };
  thumbnails: {
    key: string;
    value: ThumbnailData;
    indexes: {
      mediaId: string;
    };
  };
  content: {
    key: string;
    value: ContentRecord;
    indexes: {
      referenceCount: number;
    };
  };
  projectMedia: {
    key: [string, string];
    value: ProjectMediaAssociation;
    indexes: {
      projectId: string;
      mediaId: string;
    };
  };
  filmstrips: {
    key: string;
    value: FilmstripData;
    indexes: {
      mediaId: string;
      createdAt: number;
    };
  };
  waveforms: {
    key: string;
    value: WaveformRecord;
    indexes: {
      mediaId: string;
      createdAt: number;
    };
  };
  gifFrames: {
    key: string;
    value: GifFrameData;
    indexes: {
      mediaId: string;
      createdAt: number;
    };
  };
  decodedPreviewAudio: {
    key: string;
    value: DecodedPreviewAudio;
    indexes: {
      mediaId: string;
      createdAt: number;
    };
  };
}

export const DB_NAME = 'video-editor-db';
export const DB_VERSION = 9;

export type VideoEditorDBInstance = IDBPDatabase<VideoEditorDB>;
