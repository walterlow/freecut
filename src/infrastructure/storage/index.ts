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
} from '@/infrastructure/storage/workspace-fs/projects'

// Media
export {
  getAllMedia,
  getAllMediaMetadata,
  getMedia,
  createMedia,
  updateMedia,
  deleteMedia,
  validateMediaHandle,
  type MediaHandleValidation,
} from '@/infrastructure/storage/workspace-fs/media'

// Thumbnails
export {
  saveThumbnail,
  getThumbnailByMediaId,
  deleteThumbnailsByMediaId,
  saveProjectThumbnail,
  loadProjectThumbnail,
} from '@/infrastructure/storage/workspace-fs/thumbnails'

// Content-addressable blob references
export {
  incrementContentRef,
  decrementContentRef,
  deleteContent,
} from '@/infrastructure/storage/workspace-fs/content'

// Project-media associations
export {
  associateMediaWithProject,
  removeMediaFromProject,
  removeMediaBatchFromProject,
  getProjectMediaIds,
  getProjectsUsingMedia,
  getMediaForProject,
} from '@/infrastructure/storage/workspace-fs/project-media'

// Waveforms
export {
  getWaveform,
  getWaveformRecord,
  getWaveformMeta,
  getWaveformBins,
  saveWaveformMeta,
  saveWaveformBin,
  deleteWaveform,
} from '@/infrastructure/storage/workspace-fs/waveforms'

// GIF frames
export {
  saveGifFrames,
  getGifFrames,
  deleteGifFrames,
  clearAllGifFrames,
} from '@/infrastructure/storage/workspace-fs/gif-frames'

// Decoded preview audio
export {
  getDecodedPreviewAudio,
  saveDecodedPreviewAudio,
  deleteDecodedPreviewAudio,
} from '@/infrastructure/storage/workspace-fs/decoded-preview-audio'

// Transcripts
export {
  getTranscript,
  getTranscriptMediaIds,
  saveTranscript,
  deleteTranscript,
} from '@/infrastructure/storage/workspace-fs/transcripts'

// AI captions (vision-language-model frame descriptions)
export {
  getCaptionsByContentHash,
  saveCaptions,
  adoptCaptionsFromCache,
  deleteCaptions,
  saveCaptionThumbnail,
  getCaptionThumbnailBlob,
  probeCaptionThumbnail,
  deleteCaptionThumbnails,
  saveCaptionEmbeddings,
  getCaptionEmbeddings,
  getCaptionsEmbeddingsMeta,
  deleteCaptionEmbeddings,
  saveCaptionImageEmbeddings,
  getCaptionImageEmbeddings,
} from '@/infrastructure/storage/workspace-fs/captions'

// Media source files
export {
  hasMediaSource,
  readMediaSource,
  writeMediaSource,
} from '@/infrastructure/storage/workspace-fs/media-source'

// Workspace cache mirror helpers
export {
  mirrorBlobToWorkspace,
  mirrorJsonToWorkspace,
  readWorkspaceBlob,
  removeWorkspaceCacheEntry,
} from '@/infrastructure/storage/workspace-fs/cache-mirror'

// Workspace cache path helpers
export { proxyDir, proxyFilePath, proxyMetaPath } from '@/infrastructure/storage/workspace-fs/paths'

// Embedded text-subtitle track cache (parsed once per source fingerprint)
export {
  getEmbeddedSubtitleSidecar,
  saveEmbeddedSubtitleSidecar,
} from '@/infrastructure/storage/workspace-fs/embedded-subtitles'

// Scene-detection results
export { deleteScenes } from '@/infrastructure/storage/workspace-fs/scenes'

// Generic AI-output envelope (use these directly for new AI services)
export { readAiOutput } from '@/infrastructure/storage/workspace-fs/ai-outputs'

// Orphan cache sweep
export {
  sweepWorkspaceOrphans,
  type OrphanSweepReport,
  type OrphanSweepOptions,
} from '@/infrastructure/storage/workspace-fs/orphan-sweep'

// Final render outputs (export queue)
export {
  saveExportFile,
  listExportFiles,
  readExportFile,
  deleteExportFile,
  workspaceFolderName,
  type ExportFileEntry,
} from '@/infrastructure/storage/workspace-fs/exports'

// Per-project render-queue persistence
export {
  loadRenderQueue,
  saveRenderQueue,
} from '@/infrastructure/storage/workspace-fs/render-queue'

// Soft-delete / trash for projects
export {
  softDeleteProject,
  restoreProject,
  listTrashedProjects,
  getTrashedProjectMediaIds,
  sweepTrashOlderThan,
  DEFAULT_TRASH_TTL_MS,
  type TrashedProjectEntry,
} from '@/infrastructure/storage/workspace-fs/trash'

// User-saved effect presets (grades)
export {
  readUserEffectPresets,
  saveUserEffectPresets,
  type UserEffectPreset,
} from '@/infrastructure/storage/workspace-fs/effect-presets'

// Per-project animation presets
export {
  readAnimationPresets,
  saveAnimationPresets,
  sanitizeAnimationPresets,
  type AnimationPreset,
  type AnimationPresetProperty,
} from '@/infrastructure/storage/workspace-fs/animation-presets'
