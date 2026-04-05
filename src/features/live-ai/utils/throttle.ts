/**
 * Minimal trailing-edge throttle.
 * Ensures `fn` fires at most once per `ms` milliseconds.
 * The last call within a window is always delivered (trailing edge).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  ms: number,
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastCallTime = 0;

  function throttled(this: unknown, ...args: Parameters<T>) {
    lastArgs = args;
    const now = Date.now();
    const remaining = ms - (now - lastCallTime);

    if (remaining <= 0) {
      // Enough time has passed — fire immediately
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      lastCallTime = now;
      lastArgs = null;
      fn.apply(this, args);
    } else if (timer === null) {
      // Schedule trailing-edge call
      timer = setTimeout(() => {
        lastCallTime = Date.now();
        timer = null;
        if (lastArgs) {
          fn.apply(this, lastArgs);
          lastArgs = null;
        }
      }, remaining);
    }
  }

  throttled.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  return throttled as ((...args: Parameters<T>) => void) & { cancel: () => void };
}
