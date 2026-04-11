import { beforeEach, describe, expect, it } from 'vitest';

import { useTrackDropPreviewStore } from './track-drop-preview-store';

describe('track-drop-preview-store', () => {
  beforeEach(() => {
    useTrackDropPreviewStore.getState().clearGhostPreviews();
  });

  it('keeps state identity when clearing an already empty preview', () => {
    const initialState = useTrackDropPreviewStore.getState();

    useTrackDropPreviewStore.getState().clearGhostPreviews();

    expect(useTrackDropPreviewStore.getState()).toBe(initialState);
  });

  it('keeps state identity when setting the same previews again', () => {
    const ghostPreviews = [
      { left: 10, width: 50, label: 'clip-a', type: 'video' as const, targetTrackId: 'track-a' },
      { left: 10, width: 50, label: 'clip-a', type: 'audio' as const, targetTrackId: 'track-b' },
    ];

    useTrackDropPreviewStore.getState().setGhostPreviews(ghostPreviews);
    const firstState = useTrackDropPreviewStore.getState();

    useTrackDropPreviewStore.getState().setGhostPreviews([...ghostPreviews]);

    expect(useTrackDropPreviewStore.getState()).toBe(firstState);
  });

  it('reuses unchanged per-track preview arrays across updates', () => {
    useTrackDropPreviewStore.getState().setGhostPreviews([
      { left: 10, width: 50, label: 'clip-a', type: 'video', targetTrackId: 'track-a' },
      { left: 10, width: 50, label: 'clip-a', type: 'audio', targetTrackId: 'track-b' },
    ]);

    const firstTrackAPreviews = useTrackDropPreviewStore.getState().ghostPreviewsByTrackId['track-a'];

    useTrackDropPreviewStore.getState().setGhostPreviews([
      { left: 10, width: 50, label: 'clip-a', type: 'video', targetTrackId: 'track-a' },
      { left: 18, width: 50, label: 'clip-a', type: 'audio', targetTrackId: 'track-b' },
    ]);

    expect(useTrackDropPreviewStore.getState().ghostPreviewsByTrackId['track-a']).toBe(firstTrackAPreviews);
  });
});
