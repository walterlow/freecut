export type RenderMode = 'export' | 'preview';

export type PreviewMediabunnyInitAction = 'none' | 'await-ready' | 'warm-background-and-skip';

export interface ResolvePreviewMediabunnyInitActionOptions {
  renderMode: RenderMode;
  hasMediabunny: boolean;
  isMediabunnyDisabled: boolean;
  hasEnsureVideoItemReady: boolean;
  speed: number;
}

export interface PreviewStrictWaitingFallbackOptions {
  renderMode: RenderMode;
  hasMediabunny: boolean;
}

export interface PreviewWorkerBitmapOptions {
  renderMode: RenderMode;
}

export interface PreviewVideoElementFallbackOptions {
  hasFallbackVideoElement: boolean;
  hasMediabunny: boolean;
  isMediabunnyDisabled: boolean;
  mediabunnyFailedThisFrame: boolean;
}

export function isVariableSpeedPlayback(speed: number): boolean {
  return Math.abs(speed - 1) >= 0.01;
}

export function resolvePreviewMediabunnyInitAction(
  options: ResolvePreviewMediabunnyInitActionOptions,
): PreviewMediabunnyInitAction {
  const {
    renderMode,
    hasMediabunny,
    isMediabunnyDisabled,
    hasEnsureVideoItemReady,
    speed,
  } = options;

  if (
    renderMode !== 'preview'
    || hasMediabunny
    || isMediabunnyDisabled
    || !hasEnsureVideoItemReady
  ) {
    return 'none';
  }

  return isVariableSpeedPlayback(speed) ? 'warm-background-and-skip' : 'await-ready';
}

export function shouldUsePreviewStrictWaitingFallback(
  options: PreviewStrictWaitingFallbackOptions,
): boolean {
  const { renderMode, hasMediabunny } = options;
  return renderMode === 'preview' && !hasMediabunny;
}

export function shouldTryPreviewWorkerBitmap(options: PreviewWorkerBitmapOptions): boolean {
  const { renderMode } = options;
  return renderMode === 'preview';
}

export function shouldAllowVideoElementFallback(
  options: PreviewVideoElementFallbackOptions,
): boolean {
  const {
    hasFallbackVideoElement,
    hasMediabunny,
    isMediabunnyDisabled,
    mediabunnyFailedThisFrame,
  } = options;

  return hasFallbackVideoElement
    && (mediabunnyFailedThisFrame || !hasMediabunny || isMediabunnyDisabled);
}
