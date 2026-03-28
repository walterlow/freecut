import {
  deleteTranscript,
  getTranscript,
  getTranscriptMediaIds,
  saveTranscript,
} from '@/infrastructure/storage/indexeddb';
import { usePlaybackStore } from '@/shared/state/playback';
import { useSelectionStore } from '@/shared/state/selection';
import { createLogger } from '@/shared/logging/logger';
import type { MediaTranscript, MediaTranscriptModel } from '@/types/storage';
import type { AudioItem, TextItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline';
import type { TranscribeOptions } from '../transcription/types';
import { BrowserTranscriber } from '../transcription/browser-transcriber';
import { mediaLibraryService } from './media-library-service';
import {
  buildCaptionTextItems,
  buildCaptionTrack,
  findReplaceableCaptionItemsForClip,
  findCompatibleCaptionTrackForRanges,
  getCaptionTextItemTemplate,
  getCaptionRangeForClip,
} from '../utils/caption-items';
import { useProjectStore } from '@/features/media-library/deps/projects';
import { useTimelineStore } from '@/features/media-library/deps/timeline-stores';
import { useSettingsStore } from '@/features/media-library/deps/settings-contract';
import {
  DEFAULT_WHISPER_MODEL,
  DEFAULT_WHISPER_QUANTIZATION,
  normalizeWhisperLanguage,
} from '@/shared/utils/whisper-settings';

const logger = createLogger('MediaTranscriptionService');
const DEFAULT_MODEL: MediaTranscriptModel = DEFAULT_WHISPER_MODEL;
const DEFAULT_QUANTIZATION = DEFAULT_WHISPER_QUANTIZATION;

type CaptionableClip = AudioItem | VideoItem;
interface InsertTranscriptAsCaptionsOptions {
  clipIds?: readonly string[];
  replaceExisting?: boolean;
}

interface InsertTranscriptAsCaptionsResult {
  insertedItemCount: number;
  removedItemCount: number;
}

class MediaTranscriptionService {
  private readonly transcriber = new BrowserTranscriber({
    model: DEFAULT_MODEL,
    quantization: DEFAULT_QUANTIZATION,
  });

  getTranscript = getTranscript;
  getTranscriptMediaIds = getTranscriptMediaIds;
  deleteTranscript = deleteTranscript;

  async transcribeMedia(
    mediaId: string,
    options: Pick<TranscribeOptions, 'language' | 'model' | 'quantization' | 'onProgress'> = {},
  ): Promise<MediaTranscript> {
    const media = await mediaLibraryService.getMedia(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    if (!media.mimeType.startsWith('audio/') && !media.mimeType.startsWith('video/')) {
      throw new Error('Only audio and video files can be transcribed');
    }

    const blob = await mediaLibraryService.getMediaFile(mediaId);
    if (!blob) {
      throw new Error(`Could not load media file: ${media.fileName}`);
    }

    const file = blob instanceof File
      ? blob
      : new File([blob], media.fileName, {
          type: media.mimeType,
          lastModified: media.fileLastModified ?? Date.now(),
        });

    const settings = useSettingsStore.getState();
    const model = options.model ?? settings.defaultWhisperModel ?? DEFAULT_MODEL;
    const quantization =
      options.quantization ?? settings.defaultWhisperQuantization ?? DEFAULT_QUANTIZATION;
    const language = normalizeWhisperLanguage(options.language ?? settings.defaultWhisperLanguage);
    const stream = this.transcriber.transcribe(file, {
      model,
      language,
      quantization,
      onProgress: options.onProgress,
    });
    const segments = await stream.collect();

    const transcript: MediaTranscript = {
      id: mediaId,
      mediaId,
      model,
      language,
      quantization,
      text: segments.map((segment) => segment.text.trim()).filter(Boolean).join(' ').trim(),
      segments: segments.map((segment) => ({
        text: segment.text.trim(),
        start: segment.start,
        end: segment.end,
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveTranscript(transcript);
    logger.info('Saved transcript', {
      mediaId,
      segments: transcript.segments.length,
      model: transcript.model,
    });
    return transcript;
  }

  async insertTranscriptAsCaptions(
    mediaId: string,
    options: InsertTranscriptAsCaptionsOptions = {},
  ): Promise<InsertTranscriptAsCaptionsResult> {
    const transcript = await getTranscript(mediaId);
    if (!transcript) {
      throw new Error('No transcript found for this media item');
    }

    const timeline = useTimelineStore.getState();
    const project = useProjectStore.getState().currentProject;
    const targetClips = this.resolveCaptionTargetClips(mediaId, options.clipIds);
    if (targetClips.length === 0) {
      throw new Error('Select a clip for this media, or place one on the timeline first');
    }

    const canvasWidth = project?.metadata.width ?? 1920;
    const canvasHeight = project?.metadata.height ?? 1080;
    const newTracks: TimelineTrack[] = [...timeline.tracks];
    const generatedCaptionIdsToRemove = options.replaceExisting
      ? new Set(
          targetClips.flatMap((clip) =>
            findReplaceableCaptionItemsForClip(timeline.items, clip).map((item) => item.id)
          )
        )
      : new Set<string>();
    const plannedItems = timeline.items.filter((item) => !generatedCaptionIdsToRemove.has(item.id));
    const insertedItems: TextItem[] = [];

    for (const clip of targetClips) {
      const clipRange = getCaptionRangeForClip(clip, transcript.segments, timeline.fps);
      if (!clipRange) {
        continue;
      }

      const existingGeneratedCaptions = options.replaceExisting
        ? findReplaceableCaptionItemsForClip(timeline.items, clip)
        : [];
      const preferredTrackId = this.resolvePreferredCaptionTrackId(
        newTracks,
        plannedItems,
        existingGeneratedCaptions,
        clipRange,
      );

      let targetTrack = preferredTrackId
        ? newTracks.find((track) => track.id === preferredTrackId) ?? null
        : findCompatibleCaptionTrackForRanges(
            newTracks,
            plannedItems,
            [{ startFrame: clipRange.startFrame, endFrame: clipRange.endFrame }],
          );

      if (!targetTrack) {
        targetTrack = buildCaptionTrack(newTracks);
        newTracks.push(targetTrack);
        newTracks.sort((a, b) => a.order - b.order);
      }

      const clipCaptionItems = buildCaptionTextItems({
        mediaId,
        trackId: targetTrack.id,
        segments: transcript.segments,
        clip,
        timelineFps: timeline.fps,
        canvasWidth,
        canvasHeight,
        styleTemplate: existingGeneratedCaptions[0]
          ? getCaptionTextItemTemplate(existingGeneratedCaptions[0])
          : undefined,
      });

      if (clipCaptionItems.length === 0) {
        continue;
      }

      insertedItems.push(...clipCaptionItems);
      plannedItems.push(...clipCaptionItems);
    }

    if (insertedItems.length === 0 && generatedCaptionIdsToRemove.size === 0) {
      throw new Error('Transcript does not overlap the selected clip source range');
    }

    const tracksChanged = newTracks.length !== timeline.tracks.length
      || newTracks.some((track, index) => track.id !== timeline.tracks[index]?.id);
    if (tracksChanged) {
      timeline.setTracks(newTracks);
    }

    if (generatedCaptionIdsToRemove.size > 0) {
      timeline.removeItems([...generatedCaptionIdsToRemove]);
    }

    if (insertedItems.length > 0) {
      timeline.addItems(insertedItems);
      useSelectionStore.getState().selectItems(insertedItems.map((item) => item.id));
    }

    return {
      insertedItemCount: insertedItems.length,
      removedItemCount: generatedCaptionIdsToRemove.size,
    };
  }

  private resolveCaptionTargetClips(
    mediaId: string,
    clipIds?: readonly string[],
  ): CaptionableClip[] {
    const timeline = useTimelineStore.getState();
    const selection = useSelectionStore.getState();
    const playheadFrame = usePlaybackStore.getState().currentFrame;

    const matchingClips = timeline.items
      .filter((item): item is CaptionableClip =>
        (item.type === 'video' || item.type === 'audio') && item.mediaId === mediaId
      )
      .sort((a, b) => a.from - b.from);

    if (matchingClips.length === 0) {
      return [];
    }

    if (clipIds && clipIds.length > 0) {
      const requestedClipIds = new Set(clipIds);
      return matchingClips.filter((clip) => requestedClipIds.has(clip.id));
    }

    const selectedClips = selection.selectedItemIds
      .map((id) => matchingClips.find((clip) => clip.id === id))
      .filter((clip): clip is CaptionableClip => clip !== undefined);

    if (selectedClips.length > 0) {
      return selectedClips;
    }

    if (matchingClips.length === 1) {
      return matchingClips;
    }

    const clipAtPlayhead = matchingClips.find(
      (clip) => playheadFrame >= clip.from && playheadFrame < clip.from + clip.durationInFrames
    );
    if (clipAtPlayhead) {
      return [clipAtPlayhead];
    }

    return [];
  }

  private resolvePreferredCaptionTrackId(
    tracks: readonly TimelineTrack[],
    items: readonly TimelineItem[],
    existingCaptions: ReadonlyArray<{ trackId: string }>,
    range: { startFrame: number; endFrame: number },
  ): string | null {
    const trackIds = [...new Set(existingCaptions.map((item) => item.trackId))];
    if (trackIds.length !== 1) {
      return null;
    }

    const preferredTrack = tracks.find((track) => track.id === trackIds[0]);
    if (!preferredTrack || preferredTrack.visible === false || preferredTrack.locked || preferredTrack.isGroup) {
      return null;
    }

    const hasOverlap = items.some((item) => {
      if (item.trackId !== preferredTrack.id) {
        return false;
      }

      const itemEnd = item.from + item.durationInFrames;
      return item.from < range.endFrame && itemEnd > range.startFrame;
    });

    return hasOverlap ? null : preferredTrack.id;
  }
}

export const mediaTranscriptionService = new MediaTranscriptionService();
