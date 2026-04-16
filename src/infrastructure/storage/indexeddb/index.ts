/**
 * Storage barrel — transitioning from IndexedDB to workspace-fs.
 *
 * Function signatures are preserved exactly so consumers don't change.
 * Each line below either re-exports from the new workspace-fs layer
 * (migrated) or from the legacy IDB module (pending migration).
 *
 * Migration status tracked in `plans/dazzling-beaming-diffie.md`.
 *
 * Legacy IDB modules (projects.ts, media.ts, etc.) remain in place so the
 * one-time migration tool can read from them. Call them via their explicit
 * relative paths (e.g. `./projects`) rather than through this barrel.
 */

// Project exports — MIGRATED to workspace-fs (Phase 1).
export {
  getAllProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getDBStats,
} from '@/infrastructure/storage/workspace-fs/projects';

// Media exports — MIGRATED to workspace-fs (Phase 3).
export {
  getAllMedia,
  getMedia,
  createMedia,
  updateMedia,
  deleteMedia,
} from '@/infrastructure/storage/workspace-fs/media';

// Thumbnail exports — MIGRATED to workspace-fs (Phase 3).
export {
  saveThumbnail,
  getThumbnail,
  getThumbnailByMediaId,
  deleteThumbnailsByMediaId,
} from '@/infrastructure/storage/workspace-fs/thumbnails';

// Content exports — MIGRATED to workspace-fs (Phase 4).
export {
  incrementContentRef,
  decrementContentRef,
  deleteContent,
} from '@/infrastructure/storage/workspace-fs/content';

// Project-media association exports — MIGRATED to workspace-fs (Phase 2).
export {
  associateMediaWithProject,
  removeMediaFromProject,
  getProjectMediaIds,
  getProjectsUsingMedia,
  getMediaForProject,
} from '@/infrastructure/storage/workspace-fs/project-media';

// Waveform exports — MIGRATED to workspace-fs (Phase 8).
export {
  getWaveform,
  getWaveformRecord,
  getWaveformMeta,
  getWaveformBins,
  saveWaveformRecord,
  saveWaveformMeta,
  saveWaveformBin,
  deleteWaveform,
} from '@/infrastructure/storage/workspace-fs/waveforms';

// GIF frames exports — MIGRATED to workspace-fs (Phase 7).
export {
  saveGifFrames,
  getGifFrames,
  deleteGifFrames,
  clearAllGifFrames,
} from '@/infrastructure/storage/workspace-fs/gif-frames';

// Decoded preview audio exports — MIGRATED to workspace-fs (Phase 9).
export {
  getDecodedPreviewAudio,
  saveDecodedPreviewAudio,
  deleteDecodedPreviewAudio,
} from '@/infrastructure/storage/workspace-fs/decoded-preview-audio';

// Transcript exports — MIGRATED to workspace-fs (Phase 5).
export {
  getTranscript,
  getTranscriptMediaIds,
  saveTranscript,
  deleteTranscript,
} from '@/infrastructure/storage/workspace-fs/transcripts';
