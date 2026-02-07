import { useRef, useEffect } from 'react';
import { usePlaybackStore } from '../stores/playback-store';

/**
 * Returns previewFrame when hovering, otherwise currentFrame.
 * Reactive variant — causes re-renders on frame change.
 */
export function usePreviewOrPlaybackFrame(): number {
  const previewFrame = usePlaybackStore((s) => s.previewFrame);
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  return previewFrame ?? currentFrame;
}

/**
 * Ref-based variant for hot paths (RAF loops, direct DOM updates).
 * Does NOT cause re-renders — read `.current` in callbacks.
 */
export function usePreviewOrPlaybackFrameRef(): React.RefObject<number> {
  const ref = useRef(
    usePlaybackStore.getState().previewFrame ?? usePlaybackStore.getState().currentFrame
  );

  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      ref.current = state.previewFrame ?? state.currentFrame;
    });
  }, []);

  return ref;
}
