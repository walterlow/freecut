import { createLogger } from '@/shared/logging/logger';
import type { EvolinkTaskDetail, EvolinkTaskStatus } from '../types';

const log = createLogger('TaskPoller');

export interface PollOptions {
  /** Initial interval in ms (default 3000). */
  intervalMs?: number;
  /** Maximum polling attempts (default 200, ~30 min). */
  maxAttempts?: number;
  /** Called on each tick with the latest task detail. */
  onProgress?: (detail: EvolinkTaskDetail) => void;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

const TERMINAL_STATUSES: EvolinkTaskStatus[] = ['completed', 'failed'];

/** Backoff schedule: 3s, 5s, 8s, 10s cap. */
function nextDelay(attempt: number, base: number): number {
  const delays = [base, base * 1.7, base * 2.7, base * 3.3];
  return Math.min(delays[Math.min(attempt, delays.length - 1)] ?? base * 3.3, 10_000);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Poll an evolink.ai task until it reaches a terminal status.
 *
 * @param getStatus - function that fetches the current task detail (caller provides the HTTP call)
 * @param options - polling configuration
 * @returns the final EvolinkTaskDetail with status 'completed' or 'failed'
 */
export async function pollTask(
  getStatus: (signal?: AbortSignal) => Promise<EvolinkTaskDetail>,
  options: PollOptions = {},
): Promise<EvolinkTaskDetail> {
  const {
    intervalMs = 3_000,
    maxAttempts = 200,
    onProgress,
    signal,
  } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    let detail: EvolinkTaskDetail;
    try {
      detail = await getStatus(signal);
    } catch (err) {
      // Network glitch — log and retry (unless aborted)
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      log.warn(`Poll attempt ${attempt + 1} failed, retrying...`, err);
      await sleep(nextDelay(attempt, intervalMs), signal);
      continue;
    }

    onProgress?.(detail);

    if (TERMINAL_STATUSES.includes(detail.status)) {
      log.info(`Task ${detail.id} finished with status: ${detail.status}`);
      return detail;
    }

    await sleep(nextDelay(attempt, intervalMs), signal);
  }

  throw new Error('Task polling timed out — maximum attempts exceeded.');
}
