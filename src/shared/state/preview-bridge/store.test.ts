import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreviewBridgeStore } from './store';

describe('preview-bridge-store', () => {
  beforeEach(() => {
    usePreviewBridgeStore.setState({
      displayedFrame: null,
      visualPlaybackMode: 'player',
      captureFrame: null,
      captureFrameImageData: null,
      captureCanvasSource: null,
    });
  });

  it('has the expected initial state', () => {
    expect(usePreviewBridgeStore.getState()).toMatchObject({
      displayedFrame: null,
      visualPlaybackMode: 'player',
      captureFrame: null,
      captureFrameImageData: null,
      captureCanvasSource: null,
    });
  });

  it('normalizes displayedFrame updates', () => {
    const store = usePreviewBridgeStore.getState();

    store.setDisplayedFrame(24.6);
    expect(usePreviewBridgeStore.getState().displayedFrame).toBe(25);

    store.setDisplayedFrame(-10);
    expect(usePreviewBridgeStore.getState().displayedFrame).toBe(0);

    store.setDisplayedFrame(Number.NaN);
    expect(usePreviewBridgeStore.getState().displayedFrame).toBe(0);

    store.setDisplayedFrame(null);
    expect(usePreviewBridgeStore.getState().displayedFrame).toBeNull();
  });

  it('avoids store churn when displayedFrame is unchanged', () => {
    usePreviewBridgeStore.getState().setDisplayedFrame(42);
    const stateA = usePreviewBridgeStore.getState();

    usePreviewBridgeStore.getState().setDisplayedFrame(42);
    const stateB = usePreviewBridgeStore.getState();

    expect(stateA).toBe(stateB);
  });

  it('avoids store churn when visualPlaybackMode is unchanged', () => {
    usePreviewBridgeStore.getState().setVisualPlaybackMode('streaming');
    const stateA = usePreviewBridgeStore.getState();

    usePreviewBridgeStore.getState().setVisualPlaybackMode('streaming');
    const stateB = usePreviewBridgeStore.getState();

    expect(stateA).toBe(stateB);
  });

  it('stores capture callbacks', async () => {
    const captureFrame = vi.fn(async () => 'data:image/png;base64,abc');
    const captureFrameImageData = vi.fn(async () => null);
    const captureCanvasSource = vi.fn(async () => null);

    usePreviewBridgeStore.getState().setCaptureFrame(captureFrame);
    usePreviewBridgeStore.getState().setCaptureFrameImageData(captureFrameImageData);
    usePreviewBridgeStore.getState().setCaptureCanvasSource(captureCanvasSource);

    const state = usePreviewBridgeStore.getState();
    expect(await state.captureFrame?.()).toBe('data:image/png;base64,abc');
    expect(await state.captureFrameImageData?.()).toBeNull();
    expect(await state.captureCanvasSource?.()).toBeNull();
  });
});
