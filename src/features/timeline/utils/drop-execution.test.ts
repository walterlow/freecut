import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import {
  applyResolvedTimelineDrop,
  buildDroppedMediaEntriesFromImportedMedia,
  resolveDroppedMediaEntriesFromPayload,
} from './drop-execution';

function createMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: overrides.id ?? 'media-1',
    fileName: overrides.fileName ?? 'clip.mp4',
    mimeType: overrides.mimeType ?? 'video/mp4',
    duration: overrides.duration ?? 3,
    originalDuration: overrides.originalDuration ?? overrides.duration ?? 3,
    width: overrides.width ?? 1920,
    height: overrides.height ?? 1080,
    size: overrides.size ?? 1024,
    createdAt: overrides.createdAt ?? Date.now(),
    modifiedAt: overrides.modifiedAt ?? Date.now(),
    file: overrides.file ?? null,
    // Fields below are optional on real objects, but keep them explicit in tests.
    thumbnailBlob: overrides.thumbnailBlob,
    waveformData: overrides.waveformData,
    codec: overrides.codec,
    audioCodec: overrides.audioCodec,
    frameRate: overrides.frameRate,
  } as MediaMetadata;
}

describe('drop-execution', () => {
  it('resolves dropped media entries from a multi-item payload', () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const mediaItems = [
      createMedia({ id: 'video-1', fileName: 'clip.mp4' }),
      createMedia({ id: 'audio-1', fileName: 'track.wav', mimeType: 'audio/wav' }),
    ];

    const entries = resolveDroppedMediaEntriesFromPayload({
      type: 'media-items',
      items: [
        { mediaId: 'video-1', mediaType: 'video', fileName: 'clip.mp4', duration: 5 },
        { mediaId: 'audio-1', mediaType: 'audio', fileName: 'track.wav', duration: 8 },
        { mediaId: 'missing', mediaType: 'video', fileName: 'missing.mp4', duration: 2 },
        { mediaId: 'bad', mediaType: 'text', fileName: 'bad', duration: 1 },
      ],
    }, mediaItems, logger);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.mediaId)).toEqual(['video-1', 'audio-1']);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith('Media not found:', 'missing');
  });

  it('filters imported media to droppable entry types', () => {
    const entries = buildDroppedMediaEntriesFromImportedMedia([
      createMedia({ id: 'video-1', mimeType: 'video/mp4' }),
      createMedia({ id: 'audio-1', mimeType: 'audio/wav', fileName: 'track.wav' }),
      createMedia({ id: 'text-1', mimeType: 'text/plain', fileName: 'notes.txt' }),
    ]);

    expect(entries.map((entry) => entry.mediaId)).toEqual(['video-1', 'audio-1']);
  });

  it('applies resolved timeline drops and warns on partial placement', () => {
    const item = { id: 'item-1' } as TimelineItem;
    const notify = {
      error: vi.fn(),
      warning: vi.fn(),
    };
    const addItem = vi.fn();
    const addItems = vi.fn();
    const setTracks = vi.fn();

    const applied = applyResolvedTimelineDrop({
      addItem,
      addItems,
      currentTracks: ['track-a'],
      dropResult: {
        items: [item],
        tracks: ['track-b'],
      },
      emptyMessage: 'Unable to add dropped media items',
      notify,
      partialFailureLabel: 'dropped media items',
      requestedCount: 2,
      setTracks,
    });

    expect(applied).toBe(true);
    expect(setTracks).toHaveBeenCalledWith(['track-b']);
    expect(addItem).toHaveBeenCalledWith(item);
    expect(addItems).not.toHaveBeenCalled();
    expect(notify.warning).toHaveBeenCalledWith('Some dropped media items could not be added: 1 failed');
    expect(notify.error).not.toHaveBeenCalled();
  });
});
