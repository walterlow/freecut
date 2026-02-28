/**
 * IndexedDB storage module.
 *
 * Split into domain-specific modules for maintainability:
 * - schema.ts: Database schema types and constants
 * - connection.ts: DB initialization, connection management, quota checks
 * - projects.ts: Project CRUD operations
 * - media.ts: Media CRUD operations
 * - thumbnails.ts: Thumbnail operations
 * - content.ts: Content-addressable storage (reference counting)
 * - project-media.ts: Project-media associations
 * - waveforms.ts: Audio waveform data
 * - gif-frames.ts: GIF frame data
 */

// Project exports
export {
  getAllProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getDBStats,
} from './projects';

// Media exports
export {
  getAllMedia,
  getMedia,
  createMedia,
  updateMedia,
  deleteMedia,
} from './media';

// Thumbnail exports
export {
  saveThumbnail,
  getThumbnail,
  getThumbnailByMediaId,
  deleteThumbnailsByMediaId,
} from './thumbnails';

// Content exports
export { incrementContentRef, decrementContentRef, deleteContent } from './content';

// Project-media association exports
export {
  associateMediaWithProject,
  removeMediaFromProject,
  getProjectMediaIds,
  getProjectsUsingMedia,
  getMediaForProject,
} from './project-media';

// Waveform exports
export {
  getWaveform,
  getWaveformRecord,
  getWaveformMeta,
  getWaveformBins,
  saveWaveformRecord,
  saveWaveformMeta,
  saveWaveformBin,
  deleteWaveform,
} from './waveforms';

// GIF frames exports
export {
  saveGifFrames,
  getGifFrames,
  deleteGifFrames,
  clearAllGifFrames,
} from './gif-frames';

// Decoded preview audio exports
export {
  getDecodedPreviewAudio,
  saveDecodedPreviewAudio,
  deleteDecodedPreviewAudio,
} from './decoded-preview-audio';
