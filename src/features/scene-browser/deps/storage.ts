/**
 * Storage adapter — loads caption thumbnail blobs from workspace-fs.
 */

export {
  getCaptionThumbnailBlob,
  saveCaptionThumbnail,
  probeCaptionThumbnail,
  saveCaptionEmbeddings,
  getCaptionEmbeddings,
  getCaptionsEmbeddingsMeta,
  saveCaptionImageEmbeddings,
  getCaptionImageEmbeddings,
  getTranscript,
  getScenes,
} from '@/infrastructure/storage'
export type { SavedScenes } from '@/infrastructure/storage'
