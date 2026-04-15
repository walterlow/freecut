import type { PreviewVisualPlaybackMode } from '@/shared/state/preview-bridge';

interface RenderedPreviewCanvasVisibilityParams {
  visualPlaybackMode: PreviewVisualPlaybackMode;
  isRenderedOverlayVisible: boolean;
  displayedFrame: number | null;
  previewFrame: number | null;
  currentFrame: number;
}

export function shouldShowRenderedPreviewCanvas({
  visualPlaybackMode,
  isRenderedOverlayVisible,
  displayedFrame,
  previewFrame,
  currentFrame,
}: RenderedPreviewCanvasVisibilityParams): boolean {
  if (isRenderedOverlayVisible) {
    return true;
  }

  if (visualPlaybackMode === 'streaming') {
    return true;
  }

  if (visualPlaybackMode !== 'rendered_preview') {
    return false;
  }

  const targetFrame = previewFrame ?? currentFrame;
  return displayedFrame === targetFrame;
}
