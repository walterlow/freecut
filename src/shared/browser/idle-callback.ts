export type IdleRequestOptions = {
  timeout?: number;
};

export type IdleDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
};

type RequestIdleCallback = (cb: (deadline: IdleDeadline) => void, options?: IdleRequestOptions) => number;
type CancelIdleCallback = (handle: number) => void;

function getNative(): { requestIdleCallback?: RequestIdleCallback; cancelIdleCallback?: CancelIdleCallback } {
  if (typeof window === 'undefined') return {};
  const w = window as unknown as {
    requestIdleCallback?: RequestIdleCallback;
    cancelIdleCallback?: CancelIdleCallback;
  };
  return { requestIdleCallback: w.requestIdleCallback, cancelIdleCallback: w.cancelIdleCallback };
}

/**
 * Safari-safe `requestIdleCallback` wrapper.
 *
 * - Uses native `window.requestIdleCallback` when present.
 * - Falls back to `setTimeout` otherwise (e.g. older Safari).
 */
export function requestIdle(cb: (deadline: IdleDeadline) => void, options?: IdleRequestOptions): number {
  const native = getNative();
  if (native.requestIdleCallback) {
    return native.requestIdleCallback(cb, options);
  }

  const delayMs = Math.min(50, options?.timeout ?? 50);
  return window.setTimeout(() => {
    cb({
      didTimeout: false,
      timeRemaining: () => 0,
    });
  }, delayMs);
}

export function cancelIdle(handle: number): void {
  const native = getNative();
  if (native.cancelIdleCallback) {
    native.cancelIdleCallback(handle);
    return;
  }
  clearTimeout(handle);
}
