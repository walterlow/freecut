import { useCallback, useEffect } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { resolvePreviewDisplayedFrameAction } from '../utils/preview-displayed-frame-controller';

export interface UsePreviewDisplayedFrameControllerInput {
  isRenderedOverlayVisible: boolean;
}

function applyDisplayedFrameAction(
  setDisplayedFrame: (frame: number | null) => void,
  action: ReturnType<typeof resolvePreviewDisplayedFrameAction>,
): void {
  if (action.kind === 'clear') {
    setDisplayedFrame(null);
    return;
  }

  if (action.kind === 'set') {
    setDisplayedFrame(action.frame);
  }
}

export function usePreviewDisplayedFrameController(
  input: UsePreviewDisplayedFrameControllerInput,
): (renderedFrame: number) => void {
  const setDisplayedFrame = usePlaybackStore((state) => state.setDisplayedFrame);

  useEffect(() => {
    applyDisplayedFrameAction(
      setDisplayedFrame,
      resolvePreviewDisplayedFrameAction({
        isRenderedOverlayVisible: input.isRenderedOverlayVisible,
      }),
    );
  }, [input.isRenderedOverlayVisible, setDisplayedFrame]);

  useEffect(() => (
    () => {
      applyDisplayedFrameAction(
        setDisplayedFrame,
        resolvePreviewDisplayedFrameAction({
          isRenderedOverlayVisible: input.isRenderedOverlayVisible,
          shouldClear: true,
        }),
      );
    }
  ), [input.isRenderedOverlayVisible, setDisplayedFrame]);

  return useCallback((renderedFrame: number) => {
    applyDisplayedFrameAction(
      setDisplayedFrame,
      resolvePreviewDisplayedFrameAction({
        isRenderedOverlayVisible: input.isRenderedOverlayVisible,
        renderedFrame,
      }),
    );
  }, [input.isRenderedOverlayVisible, setDisplayedFrame]);
}
