/**
 * Storage barrel — re-exports the workspace-fs layer under the legacy
 * import path so consumers don't need to change their imports.
 *
 * All storage now lives in the user-picked workspace folder via
 * `workspace-fs/*`. Legacy `video-editor-db` IndexedDB reads are handled
 * separately by `workspace-fs/legacy-idb-reader.ts`, used only by the
 * one-time migration tool.
 */

// Projects
export {
  getAllProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getDBStats,
} from '@/infrastructure/storage/workspace-fs/projects';

// Media
export {
  getAllMedia,
  getMedia,
  createMedia,
  updateMedia,
  deleteMedia,
} from '@/infrastructure/storage/workspace-fs/media';

// Thumbnails
export {
  saveThumbnail,
  getThumbnail,
  getThumbnailByMediaId,
  deleteThumbnailsByMediaId,
} from '@/infrastructure/storage/workspace-fs/thumbnails';

// Content-addressable blob references
export {
  incrementContentRef,
  decrementContentRef,
  deleteContent,
} from '@/infrastructure/storage/workspace-fs/content';

// Project-media associations
export {
  associateMediaWithProject,
  removeMediaFromProject,
  getProjectMediaIds,
  getProjectsUsingMedia,
  getMediaForProject,
} from '@/infrastructure/storage/workspace-fs/project-media';

// Waveforms
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

// GIF frames
export {
  saveGifFrames,
  getGifFrames,
  deleteGifFrames,
  clearAllGifFrames,
} from '@/infrastructure/storage/workspace-fs/gif-frames';

// Decoded preview audio
export {
  getDecodedPreviewAudio,
  saveDecodedPreviewAudio,
  deleteDecodedPreviewAudio,
} from '@/infrastructure/storage/workspace-fs/decoded-preview-audio';

// Transcripts
export {
  getTranscript,
  getTranscriptMediaIds,
  saveTranscript,
  deleteTranscript,
} from '@/infrastructure/storage/workspace-fs/transcripts';
