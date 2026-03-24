export type IdleRequestOptions = {
  timeout?: number;
};

export type IdleDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
};

type RequestIdleCallback = (cb: (deadline: IdleDeadline) => void, options?: IdleRequestOptions) => number;
type CancelIdleCallback = (handle: number) => void;

type WindowWithIdle = Window & {
  requestIdleCallback?: RequestIdleCallback;
  cancelIdleCallback?: CancelIdleCallback;
};

/**
 * Safari-safe `requestIdleCallback` wrapper.
 *
 * - Uses native `window.requestIdleCallback` when present.
 * - Falls back to `setTimeout` otherwise (e.g. older Safari).
 */
export function requestIdle(cb: (deadline: IdleDeadline) => void, options?: IdleRequestOptions): number {
  if (typeof window !== 'undefined') {
    const w = window as WindowWithIdle;
    if (typeof w.requestIdleCallback === 'function') {
      return w.requestIdleCallback(cb, options);
    }
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
  if (typeof window !== 'undefined') {
    const w = window as WindowWithIdle;
    if (typeof w.cancelIdleCallback === 'function') {
      w.cancelIdleCallback(handle);
      return;
    }
  }
  clearTimeout(handle);
}
