import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TimelineItem } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import type { DroppedMediaEntry } from './drop-execution';
import { prewarmDroppedTimelineAudio } from './drop-audio-prewarm';

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudioSliceForPlayback: vi.fn(),
}));

const nativeWarmMocks = vi.hoisted(() => ({
  prewarmPreviewAudioElement: vi.fn(),
}));

const previewBudgetMocks = vi.hoisted(() => ({
  registerPreviewAudioStartupHold: vi.fn(),
}));

vi.mock('@/features/timeline/deps/composition-runtime', async () => {
  const actual = await vi.importActual<typeof import('@/features/timeline/deps/composition-runtime')>('@/features/timeline/deps/composition-runtime');
  return {
    ...actual,
    getOrDecodeAudioSliceForPlayback: audioDecodeMocks.getOrDecodeAudioSliceForPlayback,
    prewarmPreviewAudioElement: nativeWarmMocks.prewarmPreviewAudioElement,
  };
});

vi.mock('../hooks/preview-work-budget', () => ({
  registerPreviewAudioStartupHold: previewBudgetMocks.registerPreviewAudioStartupHold,
}));

function createMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: overrides.id ?? 'media-1',
    storageType: overrides.storageType ?? 'opfs',
    fileName: overrides.fileName ?? 'clip.mp4',
    fileSize: overrides.fileSize ?? 1024,
    mimeType: overrides.mimeType ?? 'video/mp4',
    duration: overrides.duration ?? 4,
    width: overrides.width ?? 1920,
    height: overrides.height ?? 1080,
    fps: overrides.fps ?? 30,
    codec: overrides.codec ?? 'h264',
    bitrate: overrides.bitrate ?? 1000,
    audioCodec: overrides.audioCodec,
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
}

describe('drop-audio-prewarm', () => {
  beforeEach(() => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockReset();
    nativeWarmMocks.prewarmPreviewAudioElement.mockReset();
    previewBudgetMocks.registerPreviewAudioStartupHold.mockReset().mockReturnValue(vi.fn());
  });

  it('prewarms native dropped video audio immediately', () => {
    const entries: DroppedMediaEntry[] = [{
      media: createMedia({ id: 'media-1', audioCodec: 'aac' }),
      mediaId: 'media-1',
      mediaType: 'video',
      label: 'clip.mp4',
    }];
    const items: TimelineItem[] = [{
      id: 'item-1',
      trackId: 'track-1',
      type: 'video',
      mediaId: 'media-1',
      src: 'blob://video',
      label: 'clip.mp4',
      from: 0,
      durationInFrames: 120,
      sourceStart: 45,
      sourceFps: 30,
    }];

    prewarmDroppedTimelineAudio(entries, items);

    expect(previewBudgetMocks.registerPreviewAudioStartupHold).toHaveBeenCalledWith({
      minDurationMs: 1200,
      maxDurationMs: 6000,
    });
    expect(nativeWarmMocks.prewarmPreviewAudioElement).toHaveBeenCalledWith('blob://video', 1.5);
    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).not.toHaveBeenCalled();
  });

  it('kicks custom-decoder prewarm for unsupported codecs', () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: { duration: 8 },
      startTime: 0,
      isComplete: false,
    });

    const entries: DroppedMediaEntry[] = [{
      media: createMedia({
        id: 'media-2',
        mimeType: 'audio/ogg',
        codec: 'vorbis',
      }),
      mediaId: 'media-2',
      mediaType: 'audio',
      label: 'track.ogg',
    }];
    const items: TimelineItem[] = [{
      id: 'item-2',
      trackId: 'track-1',
      type: 'audio',
      mediaId: 'media-2',
      src: 'blob://audio',
      label: 'track.ogg',
      from: 0,
      durationInFrames: 240,
      sourceStart: 60,
      sourceFps: 30,
    }];

    prewarmDroppedTimelineAudio(entries, items);

    expect(previewBudgetMocks.registerPreviewAudioStartupHold).toHaveBeenCalledWith({
      minDurationMs: 1200,
      maxDurationMs: 6000,
    });
    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith('media-2', 'blob://audio', {
      minReadySeconds: 2,
      waitTimeoutMs: 6000,
      targetTimeSeconds: 2,
    });
    expect(nativeWarmMocks.prewarmPreviewAudioElement).not.toHaveBeenCalled();
  });

  it('deduplicates linked companions from the same dropped source', () => {
    const entries: DroppedMediaEntry[] = [{
      media: createMedia({ id: 'media-3', audioCodec: 'aac' }),
      mediaId: 'media-3',
      mediaType: 'video',
      label: 'clip.mp4',
    }];
    const items: TimelineItem[] = [
      {
        id: 'video-1',
        trackId: 'track-video',
        type: 'video',
        mediaId: 'media-3',
        src: 'blob://shared',
        label: 'clip.mp4',
        from: 0,
        durationInFrames: 120,
        sourceFps: 30,
      },
      {
        id: 'audio-1',
        trackId: 'track-audio',
        type: 'audio',
        mediaId: 'media-3',
        src: 'blob://shared',
        label: 'clip.mp4',
        from: 0,
        durationInFrames: 120,
        sourceFps: 30,
      },
    ];

    prewarmDroppedTimelineAudio(entries, items);

    expect(previewBudgetMocks.registerPreviewAudioStartupHold).toHaveBeenCalledTimes(1);
    expect(nativeWarmMocks.prewarmPreviewAudioElement).toHaveBeenCalledTimes(1);
  });

  it('skips the startup hold when the dropped media has no audio track', () => {
    const entries: DroppedMediaEntry[] = [{
      media: createMedia({ id: 'media-4', audioCodec: undefined }),
      mediaId: 'media-4',
      mediaType: 'video',
      label: 'silent.mp4',
    }];
    const items: TimelineItem[] = [{
      id: 'item-4',
      trackId: 'track-1',
      type: 'video',
      mediaId: 'media-4',
      src: 'blob://silent-video',
      label: 'silent.mp4',
      from: 0,
      durationInFrames: 120,
      sourceFps: 30,
    }];

    prewarmDroppedTimelineAudio(entries, items);

    expect(previewBudgetMocks.registerPreviewAudioStartupHold).not.toHaveBeenCalled();
    expect(nativeWarmMocks.prewarmPreviewAudioElement).not.toHaveBeenCalled();
    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).not.toHaveBeenCalled();
  });
});
