export type PreviewDisplayedFrameAction =
  | { kind: 'ignore' }
  | { kind: 'clear' }
  | { kind: 'set'; frame: number };

export interface ResolvePreviewDisplayedFrameActionInput {
  isRenderedOverlayVisible: boolean;
  renderedFrame?: number;
  shouldClear?: boolean;
}

export function resolvePreviewDisplayedFrameAction(
  input: ResolvePreviewDisplayedFrameActionInput,
): PreviewDisplayedFrameAction {
  if (input.shouldClear) {
    return { kind: 'clear' };
  }

  if (typeof input.renderedFrame === 'number') {
    return {
      kind: 'set',
      frame: input.renderedFrame,
    };
  }

  if (!input.isRenderedOverlayVisible) {
    return { kind: 'clear' };
  }

  return { kind: 'ignore' };
}
