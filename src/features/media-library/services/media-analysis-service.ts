/**
 * Runs the "Analyze with AI" pipeline for a single media item — captions,
 * dominant-color palette, text embeddings, and CLIP image embeddings — so
 * both the media card's per-item menu and the scene browser's "analyze all"
 * action hit the exact same path.
 *
 * Extracted from `media-card.tsx` so there's one authoritative flow for
 * wiping stale thumbs/embeddings, running the captioner, indexing, and
 * persisting to the workspace. The call site does nothing but drive UI.
 */

import type { MediaMetadata } from '@/types/storage';
import {
  captionVideo,
  captionImage,
  type MediaCaption,
  embeddingsProvider,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_DIM,
  clipProvider,
  CLIP_MODEL_ID,
  CLIP_EMBEDDING_DIM,
  buildEmbeddingText,
  extractDominantColors,
} from '../deps/analysis';
import {
  useSettingsStore,
  resolveCaptioningIntervalSec,
} from '../deps/settings-contract';
import {
  saveCaptionThumbnail,
  deleteCaptionThumbnails,
  deleteCaptionEmbeddings,
  saveCaptionEmbeddings,
  saveCaptionImageEmbeddings,
  getTranscript,
} from '@/infrastructure/storage';
import { invalidateMediaCaptionThumbnails } from '../deps/scene-browser';
import { useMediaLibraryStore } from '../stores/media-library-store';
import { mediaLibraryService } from './media-library-service';
import { getMediaType } from '../utils/validation';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('MediaAnalysisService');

export interface AnalyzeBatchResult {
  analyzed: number;
  skipped: number;
  failed: number;
}

export interface AnalyzeBatchOptions {
  /** When true, only analyze media that has no captions yet. Default: false (re-analyze everything). */
  onlyMissing?: boolean;
  /** Optional filter for which media to consider (e.g. a single scope id). */
  mediaIds?: readonly string[];
}

class MediaAnalysisService {
  private batchInFlight = false;

  /**
   * Analyze a single media item end-to-end. Accepts either a mediaId (resolved
   * from the library store) or the full `MediaMetadata` when the caller
   * already has it. Returns true on success, false on failure — notifications
   * are surfaced via the media-library store either way.
   *
   * When called standalone (not from `analyzeBatch`), wraps itself as a
   * 1-item run so the background progress bar shows a concrete 0→100%
   * instead of a pulsing indeterminate bar.
   */
  async analyzeMedia(mediaOrId: string | MediaMetadata): Promise<boolean> {
    const store = useMediaLibraryStore.getState();
    const media = typeof mediaOrId === 'string'
      ? store.mediaItems.find((m) => m.id === mediaOrId)
      : mediaOrId;
    if (!media) return false;

    const ownsRun = !this.batchInFlight && !store.analysisProgress;
    if (ownsRun) {
      store.beginAnalysisRun(1);
    }
    try {
      const ok = await this.analyzeOne(media);
      if (ownsRun) {
        useMediaLibraryStore.getState().incrementAnalysisCompleted(1);
      }
      return ok;
    } finally {
      if (ownsRun) {
        useMediaLibraryStore.getState().endAnalysisRun();
      }
    }
  }

  private async analyzeOne(media: MediaMetadata): Promise<boolean> {
    const store = useMediaLibraryStore.getState();
    const mediaType = getMediaType(media.mimeType);
    if (mediaType !== 'video' && mediaType !== 'image') return false;

    const { captioningIntervalUnit, captioningIntervalValue } = useSettingsStore.getState();
    const sampleIntervalSec = resolveCaptioningIntervalSec(
      captioningIntervalUnit,
      captioningIntervalValue,
      media.fps,
    );

    store.setTaggingMedia(media.id, true);

    try {
      // Drop every in-memory thumbnail URL and semantic cache entry tied to
      // this media before re-analysis starts. If the rerun fails, the old
      // on-disk assets still exist and can be rehydrated on demand; if it
      // succeeds, fresh thumbs/embeddings repopulate the caches below.
      invalidateMediaCaptionThumbnails(media.id);

      let captions: MediaCaption[];
      const stagedThumbnailBlobs = new Map<number, Blob>();

      const stageThumbnail = async (index: number, blob: Blob): Promise<string | undefined> => {
        stagedThumbnailBlobs.set(index, blob);
        return undefined;
      };

      if (mediaType === 'video') {
        const blobUrl = await mediaLibraryService.getMediaBlobUrl(media.id);
        if (!blobUrl) throw new Error('Could not load media file');

        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        video.src = blobUrl;

        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('Failed to load video'));
        });

        try {
          captions = await captionVideo(video, {
            sampleIntervalSec,
            saveThumbnail: stageThumbnail,
          });
        } finally {
          video.src = '';
          URL.revokeObjectURL(blobUrl);
        }
      } else {
        const blobUrl = await mediaLibraryService.getMediaBlobUrl(media.id);
        if (!blobUrl) throw new Error('Could not load media file');

        const response = await fetch(blobUrl);
        const blob = await response.blob();
        URL.revokeObjectURL(blobUrl);
        captions = await captionImage(blob, { saveThumbnail: stageThumbnail });
      }

      if (captions.length > 0) {
        let embeddingModel: string | undefined;
        let embeddingDim: number | undefined;
        let imageEmbeddingModel: string | undefined;
        let imageEmbeddingDim: number | undefined;
        let captionsWithEmbeddings = captions;

        const thumbBlobs = captions.map((_, index) =>
          stagedThumbnailBlobs.get(index) ?? null,
        );

        const colorResults = await Promise.all(
          thumbBlobs.map(async (blob) => {
            if (!blob) return { phrase: '', palette: [] as const };
            try { return await extractDominantColors(blob); }
            catch { return { phrase: '', palette: [] as const }; }
          }),
        );
        const palettesByIndex = colorResults.map((r) => r.palette);

        captionsWithEmbeddings = captions.map((caption, i) => {
          const palette = palettesByIndex[i];
          const next = { ...caption } as typeof caption & {
            palette?: typeof palette;
          };
          if (palette && palette.length > 0) next.palette = [...palette];
          return next;
        });

        try {
          await embeddingsProvider.ensureReady();

          const transcript = await getTranscript(media.id).catch(() => null);

          const texts = captions.map((caption, i) => buildEmbeddingText({
            caption: { text: caption.text, timeSec: caption.timeSec },
            sceneData: caption.sceneData,
            transcriptSegments: transcript?.segments,
            colorPhrase: colorResults[i]?.phrase ?? '',
          }));

          const vectors = await embeddingsProvider.embedBatch(texts);
          if (vectors.length === captions.length) {
            await saveCaptionEmbeddings(media.id, vectors, EMBEDDING_MODEL_DIM);
            embeddingModel = EMBEDDING_MODEL_ID;
            embeddingDim = EMBEDDING_MODEL_DIM;
            captionsWithEmbeddings = captionsWithEmbeddings.map((caption, i) => ({
              ...caption,
              embedding: Array.from(vectors[i]!),
            }));
          }
        } catch (error) {
          store.showNotification({
            type: 'warning',
            message: `Semantic indexing skipped for "${media.fileName}" — keyword search still works.`,
          });
          void error;
        }

        try {
          const validBlobs = thumbBlobs.filter((b): b is Blob => b !== null);
          if (validBlobs.length > 0 && validBlobs.length === captions.length) {
            await clipProvider.ensureReady();
            const imageVectors = await clipProvider.embedImages(validBlobs);
            if (imageVectors.length === captions.length) {
              await saveCaptionImageEmbeddings(media.id, imageVectors, CLIP_EMBEDDING_DIM);
              imageEmbeddingModel = CLIP_MODEL_ID;
              imageEmbeddingDim = CLIP_EMBEDDING_DIM;
            }
          }
        } catch (error) {
          void error;
        }

        if (stagedThumbnailBlobs.size > 0) {
          captionsWithEmbeddings = await Promise.all(
            captionsWithEmbeddings.map(async (caption, index) => {
              const blob = stagedThumbnailBlobs.get(index);
              if (!blob) return caption;
              try {
                const thumbRelPath = await saveCaptionThumbnail(media.id, index, blob);
                return { ...caption, thumbRelPath };
              } catch {
                return caption;
              }
            }),
          );
        }

        await mediaLibraryService.updateMediaCaptions(media.id, captionsWithEmbeddings, {
          sampleIntervalSec,
          embeddingModel,
          embeddingDim,
          imageEmbeddingModel,
          imageEmbeddingDim,
        });
        store.updateMediaCaptions(media.id, captionsWithEmbeddings);

        const sceneCaptionCountLabel = `${captions.length} scene caption${captions.length === 1 ? '' : 's'}`;
        store.showNotification({
          type: 'success',
          message: `Generated ${sceneCaptionCountLabel} for "${media.fileName}"`,
        });
      } else {
        await mediaLibraryService.updateMediaCaptions(media.id, [], {
          sampleIntervalSec,
        });
        store.updateMediaCaptions(media.id, []);
        await deleteCaptionThumbnails(media.id);
        await deleteCaptionEmbeddings(media.id);
        store.showNotification({
          type: 'info',
          message: `No scene captions generated for "${media.fileName}"`,
        });
      }
      return true;
    } catch (error) {
      store.showNotification({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to analyze media',
      });
      return false;
    } finally {
      store.setTaggingMedia(media.id, false);
    }
  }

  /**
   * Analyze a batch of media sequentially. Sequential avoids thrashing the
   * shared WebGPU device and CLIP model — parallelism here would starve the
   * preview canvas and risk OOM on longer videos.
   *
   * A single batch is the unit of concurrency — calling twice while one is
   * running is a no-op (second call resolves immediately with zeros). The
   * per-item tagging flag blocks any overlapping per-card "Analyze" clicks.
   */
  async analyzeBatch(options: AnalyzeBatchOptions = {}): Promise<AnalyzeBatchResult> {
    if (this.batchInFlight) {
      return { analyzed: 0, skipped: 0, failed: 0 };
    }
    this.batchInFlight = true;

    const store = useMediaLibraryStore.getState();
    const all = store.mediaItems;
    const pool = options.mediaIds
      ? all.filter((m) => options.mediaIds!.includes(m.id))
      : all;

    const targets = pool.filter((m) => {
      const type = getMediaType(m.mimeType);
      if (type !== 'video' && type !== 'image') return false;
      if (options.onlyMissing && (m.aiCaptions?.length ?? 0) > 0) return false;
      return true;
    });

    let analyzed = 0;
    let failed = 0;
    let cancelled = 0;
    const skipped = pool.length - targets.length;

    try {
      if (targets.length === 0) {
        store.showNotification({
          type: 'info',
          message: options.onlyMissing
            ? 'No unanalyzed media to process.'
            : 'No media to analyze.',
        });
        return { analyzed: 0, skipped, failed: 0 };
      }

      store.beginAnalysisRun(targets.length);
      store.showNotification({
        type: 'info',
        message: targets.length === 1
          ? `Analyzing "${firstName(targets)}"…`
          : `Analyzing ${targets.length} media files…`,
      });

      for (const media of targets) {
        // Cancel is cooperative — the in-flight item finishes first. Any
        // remaining items are skipped but still counted toward `completed`
        // so the progress bar reaches 100% and unmounts cleanly instead
        // of stranding the user with a stuck bar.
        const { analysisProgress } = useMediaLibraryStore.getState();
        if (analysisProgress?.cancelRequested) {
          cancelled = targets.length - (analyzed + failed);
          useMediaLibraryStore.getState().incrementAnalysisCompleted(cancelled);
          break;
        }
        logger.info('batch analyzing media', { mediaId: media.id, fileName: media.fileName });
        const ok = await this.analyzeOne(media);
        if (ok) analyzed += 1;
        else failed += 1;
        useMediaLibraryStore.getState().incrementAnalysisCompleted(1);
      }

      if (targets.length > 1) {
        const suffix = failed > 0 ? ` — ${failed} failed` : '';
        const cancelSuffix = cancelled > 0 ? ` (${cancelled} cancelled)` : '';
        store.showNotification({
          type: cancelled > 0 ? 'warning' : (failed === 0 ? 'success' : 'warning'),
          message: `Analyzed ${analyzed}/${targets.length}${suffix}${cancelSuffix}`,
        });
      }
    } finally {
      useMediaLibraryStore.getState().endAnalysisRun();
      this.batchInFlight = false;
    }

    return { analyzed, skipped, failed };
  }

  /** Ask the currently running analysis to stop after the in-flight item. */
  requestCancel(): void {
    useMediaLibraryStore.getState().requestAnalysisCancel();
  }

  isBatchInFlight(): boolean {
    return this.batchInFlight;
  }
}

function firstName(items: readonly MediaMetadata[]): string {
  return items[0]?.fileName ?? '';
}

export const mediaAnalysisService = new MediaAnalysisService();
