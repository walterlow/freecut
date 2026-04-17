import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaTranscript } from '@/types/storage';
import type { TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline';

const getTranscriptMock = vi.fn();
const useTimelineStoreGetStateMock = vi.fn();
const useProjectStoreGetStateMock = vi.fn();
const useSelectionStoreGetStateMock = vi.fn();
const usePlaybackStoreGetStateMock = vi.fn();

vi.mock('@/infrastructure/storage', () => ({
  deleteTranscript: vi.fn(),
  getTranscript: getTranscriptMock,
  getTranscriptMediaIds: vi.fn(),
  saveTranscript: vi.fn(),
}));

vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: {
    getState: useSelectionStoreGetStateMock,
  },
}));

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: usePlaybackStoreGetStateMock,
  },
}));

vi.mock('@/features/media-library/deps/projects', () => ({
  useProjectStore: {
    getState: useProjectStoreGetStateMock,
  },
}));

vi.mock('@/features/media-library/deps/timeline-stores', () => ({
  useTimelineStore: {
    getState: useTimelineStoreGetStateMock,
  },
}));

vi.mock('@/features/media-library/deps/settings-contract', () => ({
  useSettingsStore: {
    getState: () => ({
      defaultWhisperModel: 'tiny',
      defaultWhisperQuantization: 'q8',
      defaultWhisperLanguage: 'auto',
    }),
  },
}));

vi.mock('../transcription/registry', () => ({
  getDefaultMediaTranscriptionAdapter: () => ({
    createTranscriber: () => ({
      transcribe: vi.fn(),
    }),
  }),
  getMediaTranscriptionModelLabel: () => 'Tiny',
}));

const { mediaTranscriptionService } = await import('./media-transcription-service');

function makeTrack(id: string, order: number): TimelineTrack {
  return {
    id,
    name: id,
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order,
    items: [],
  };
}

function makeTextItem(
  id: string,
  trackId: string,
  from: number,
  durationInFrames: number,
): TimelineItem {
  return {
    id,
    type: 'text',
    trackId,
    from,
    durationInFrames,
    label: id,
    text: id,
    color: '#fff',
  };
}

describe('mediaTranscriptionService.insertTranscriptAsCaptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSelectionStoreGetStateMock.mockReturnValue({
      selectedItemIds: [],
      selectItems: vi.fn(),
    });
    usePlaybackStoreGetStateMock.mockReturnValue({ currentFrame: 0 });
    useProjectStoreGetStateMock.mockReturnValue({
      currentProject: {
        metadata: {
          width: 1920,
          height: 1080,
        },
      },
    });
  });

  it('creates a new captions track above the clip track when no compatible track exists', async () => {
    const clip: VideoItem = {
      id: 'clip-1',
      type: 'video',
      trackId: 'track-video',
      from: 0,
      durationInFrames: 90,
      label: 'Clip',
      mediaId: 'media-1',
      src: 'blob:test',
      sourceStart: 0,
      sourceEnd: 90,
      sourceDuration: 90,
      sourceFps: 30,
      speed: 1,
    };
    const initialTracks = [
      makeTrack('track-top', 0),
      makeTrack('track-video', 1),
      makeTrack('track-bottom', 2),
    ];
    const setTracks = vi.fn();
    const removeItems = vi.fn();
    const addItems = vi.fn();

    useTimelineStoreGetStateMock.mockReturnValue({
      fps: 30,
      tracks: initialTracks,
      items: [
        clip,
        makeTextItem('top-blocker', 'track-top', 0, 90),
        makeTextItem('bottom-blocker', 'track-bottom', 0, 90),
      ],
      setTracks,
      removeItems,
      addItems,
    });

    const transcript: MediaTranscript = {
      id: 'media-1',
      mediaId: 'media-1',
      model: 'tiny',
      language: 'auto',
      quantization: 'q8',
      text: 'Hello there',
      segments: [
        { text: 'Hello there', start: 0, end: 2 },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    getTranscriptMock.mockResolvedValue(transcript);

    const result = await mediaTranscriptionService.insertTranscriptAsCaptions('media-1', {
      clipIds: ['clip-1'],
    });

    expect(result).toEqual({
      insertedItemCount: 1,
      removedItemCount: 0,
    });
    expect(setTracks).toHaveBeenCalledTimes(1);

    const updatedTracks = setTracks.mock.calls[0][0] as TimelineTrack[];
    const captionTrack = updatedTracks.find((track) => !initialTracks.some((existing) => existing.id === track.id));
    expect(captionTrack).toBeDefined();
    expect(captionTrack?.order).toBe(0.5);

    expect(addItems).toHaveBeenCalledTimes(1);
    const insertedItems = addItems.mock.calls[0][0] as TimelineItem[];
    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0]?.trackId).toBe(captionTrack?.id);
    expect(removeItems).not.toHaveBeenCalled();
  });
});
