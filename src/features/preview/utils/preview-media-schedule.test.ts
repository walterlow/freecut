import { describe, expect, it } from 'vitest';
import type { TimelineTrack } from '@/types/timeline';
import {
  collectSourceWarmCandidateScores,
  collectResolveMediaPriorities,
  createPreviewMediaScheduleIndex,
  getPreviewMediaWindowPriority,
  scanPreloadMediaPriorities,
} from './preview-media-schedule';

function createTracks(): TimelineTrack[] {
  return [
    {
      id: 'track-a',
      name: 'A',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'text',
          type: 'text',
          trackId: 'track-a',
          from: 0,
          durationInFrames: 20,
          label: 'Title',
          text: 'hello',
          color: '#fff',
        },
        {
          id: 'video-a',
          type: 'video',
          trackId: 'track-a',
          from: 20,
          durationInFrames: 30,
          label: 'A',
          mediaId: 'media-a',
          src: '',
        },
        {
          id: 'image-b',
          type: 'image',
          trackId: 'track-a',
          from: 80,
          durationInFrames: 20,
          label: 'B',
          mediaId: 'media-b',
          src: '',
        },
      ],
    },
    {
      id: 'track-b',
      name: 'B',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [
        {
          id: 'audio-a',
          type: 'audio',
          trackId: 'track-b',
          from: 40,
          durationInFrames: 20,
          label: 'A audio',
          mediaId: 'media-a',
          src: '',
        },
        {
          id: 'video-c',
          type: 'video',
          trackId: 'track-b',
          from: 110,
          durationInFrames: 25,
          label: 'C',
          mediaId: 'media-c',
          src: '',
        },
      ],
    },
  ];
}

describe('createPreviewMediaScheduleIndex', () => {
  it('keeps only media-backed video, audio, and image spans', () => {
    const index = createPreviewMediaScheduleIndex(
      createTracks(),
      new Map([
        ['media-a', 3],
        ['media-b', 2],
        ['media-c', 5],
      ]),
    );

    expect(index.tracks.map((track) => track.entries.map((entry) => entry.mediaId))).toEqual([
      ['media-a', 'media-b'],
      ['media-a', 'media-c'],
    ]);
    expect(index.entries).toHaveLength(4);
  });
});

describe('getPreviewMediaWindowPriority', () => {
  it('adds a scrub-direction penalty for entries behind a forward scrub', () => {
    expect(getPreviewMediaWindowPriority(
      {
        mediaId: 'media-a',
        from: 10,
        durationInFrames: 20,
        endFrame: 30,
        centerFrame: 20,
        cost: 2,
      },
      {
        anchorFrame: 50,
        costPenaltyFrames: 10,
        scrubDirection: 1,
        scrubDirectionBiasFrames: 12,
      },
    )).toEqual({
      score: 52,
      directionPenaltyApplied: true,
    });
  });
});

describe('collectResolveMediaPriorities', () => {
  it('dedupes repeated media IDs to the nearest visible span', () => {
    const index = createPreviewMediaScheduleIndex(
      createTracks(),
      new Map([
        ['media-a', 3],
        ['media-b', 2],
        ['media-c', 5],
      ]),
    );

    const result = collectResolveMediaPriorities({
      index,
      unresolvedMediaIds: new Set(['media-a', 'media-c']),
      anchorFrame: 45,
      activeWindowStartFrame: 20,
      activeWindowEndFrame: 90,
      costPenaltyFrames: 10,
    });

    expect(result.priorityByMediaId.get('media-a')).toBe(30);
    expect(result.priorityByMediaId.get('media-c')).toBe(115);
    expect(result.maxActiveWindowCost).toBe(3);
  });
});

describe('scanPreloadMediaPriorities', () => {
  it('uses the scan cursor for non-scrub scans and yields the next cursor on budget hit', () => {
    const index = createPreviewMediaScheduleIndex(
      createTracks(),
      new Map([
        ['media-a', 3],
        ['media-b', 2],
        ['media-c', 5],
      ]),
    );
    let nowMs = 0;

    const result = scanPreloadMediaPriorities({
      index,
      unresolvedMediaIds: new Set(['media-a', 'media-b', 'media-c']),
      anchorFrame: 40,
      preloadStartFrame: 20,
      preloadEndFrame: 120,
      scrubDirection: 0,
      now: 0,
      getResolveRetryAt: () => 0,
      costPenaltyFrames: 10,
      scrubDirectionBiasFrames: 12,
      scanCursor: { trackIndex: 0, itemIndex: 1 },
      scanStartTimeMs: 0,
      scanTimeBudgetMs: 1,
      readTimeMs: () => ++nowMs,
      useDirectionalScan: false,
    });

    expect([...result.mediaToPreloadScores.keys()]).toEqual(['media-b']);
    expect(result.reachedScanTimeBudget).toBe(true);
    expect(result.nextCursor).toEqual({ trackIndex: 1, itemIndex: 0 });
  });

  it('starts from the directional scrub edge and rotates tracks after a full pass', () => {
    const index = createPreviewMediaScheduleIndex(
      createTracks(),
      new Map([
        ['media-a', 3],
        ['media-b', 2],
        ['media-c', 5],
      ]),
    );

    const result = scanPreloadMediaPriorities({
      index,
      unresolvedMediaIds: new Set(['media-a', 'media-b', 'media-c']),
      anchorFrame: 90,
      preloadStartFrame: 40,
      preloadEndFrame: 120,
      scrubDirection: -1,
      now: 0,
      getResolveRetryAt: () => 0,
      costPenaltyFrames: 10,
      scrubDirectionBiasFrames: 12,
      scanCursor: { trackIndex: 0, itemIndex: 0 },
      scanStartTimeMs: 0,
      scanTimeBudgetMs: 100,
      readTimeMs: () => 0,
      useDirectionalScan: true,
    });

    expect(result.mediaToPreloadScores.get('media-b')).toBe(20);
    expect(result.mediaToPreloadScores.get('media-a')).toBe(60);
    expect(result.mediaToPreloadScores.has('media-c')).toBe(false);
    expect(result.nextCursor).toEqual({ trackIndex: 1, itemIndex: 0 });
  });
});

describe('collectSourceWarmCandidateScores', () => {
  it('dedupes source spans across playback and scrub windows by lowest score', () => {
    const candidateScores = collectSourceWarmCandidateScores([
      {
        spans: [
          { src: 'blob:a', startFrame: 20, endFrame: 60 },
          { src: 'blob:b', startFrame: 80, endFrame: 100 },
        ],
        anchorFrame: 40,
        windowFrames: 60,
        baseScore: 100,
      },
      {
        spans: [
          { src: 'blob:a', startFrame: 38, endFrame: 50 },
          { src: 'blob:c', startFrame: 35, endFrame: 45 },
        ],
        anchorFrame: 42,
        windowFrames: 12,
        baseScore: 0,
      },
    ]);

    expect([...candidateScores.entries()]).toEqual([
      ['blob:a', 0],
      ['blob:b', 140],
      ['blob:c', 0],
    ]);
  });
});
