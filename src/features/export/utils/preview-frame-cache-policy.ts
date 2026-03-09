export function shouldCacheRenderedPreviewFrame(args: {
  frame: number;
  lastRenderedFrame: number;
  activeTransitionCount: number;
}): boolean {
  const { frame, lastRenderedFrame, activeTransitionCount } = args;
  const delta = frame - lastRenderedFrame;
  const isSequentialForward = delta > 0 && delta <= 3;

  if (activeTransitionCount > 0) {
    return true;
  }

  return !isSequentialForward;
}
