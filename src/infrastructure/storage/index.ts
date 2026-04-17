/**
 * Storage barrel — re-exports the workspace-fs layer.
 *
 * All storage now lives in the user-picked workspace folder via
 * `workspace-fs/*`. Legacy `video-editor-db` IndexedDB reads live under
 * `legacy-idb/` and are only touched by the one-time migration banner.
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
