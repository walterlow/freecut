import { beforeEach, describe, expect, it } from 'vitest';
import { useSourcePlayerStore } from './store';

describe('source-player-store', () => {
  beforeEach(() => {
    useSourcePlayerStore.setState({
      hoveredPanel: null,
      playerMethods: null,
      currentMediaId: null,
      currentSourceFrame: 0,
      previewSourceFrame: null,
      inPoint: null,
      outPoint: null,
      pendingSeekFrame: null,
    });
  });

  it('clears source monitor state when the active owner releases it', () => {
    const store = useSourcePlayerStore.getState();

    store.setCurrentMediaId('media-1');
    store.setInPoint(12);
    store.setOutPoint(48);
    store.releaseCurrentMediaId('media-1');

    expect(useSourcePlayerStore.getState()).toMatchObject({
      currentMediaId: null,
      currentSourceFrame: 0,
      previewSourceFrame: null,
      inPoint: null,
      outPoint: null,
    });
  });

  it('preserves source monitor state when another media item has taken ownership', () => {
    const store = useSourcePlayerStore.getState();

    store.setCurrentMediaId('media-1');
    store.setCurrentMediaId('media-2');
    store.setInPoint(75);
    store.setOutPoint(150);
    store.setPendingSeekFrame(75);
    store.releaseCurrentMediaId('media-1');

    expect(useSourcePlayerStore.getState()).toMatchObject({
      currentMediaId: 'media-2',
      inPoint: 75,
      outPoint: 150,
      previewSourceFrame: null,
      pendingSeekFrame: 75,
    });
  });
});
