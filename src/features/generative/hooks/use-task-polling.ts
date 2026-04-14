import { useRef, useCallback } from 'react';
import { pollTask } from '../services/task-poller';
import type { EvolinkTaskDetail, TaskState } from '../types';
import { IDLE_TASK } from '../types';

type SetTask = (task: Partial<TaskState>) => void;

/**
 * Hook that wraps task-poller for React lifecycle.
 * Manages an AbortController that auto-aborts when `cancel` is called.
 */
export function useTaskPolling(setTask: SetTask) {
  const abortRef = useRef<AbortController | null>(null);

  const startPolling = useCallback(
    async (
      taskId: string,
      getStatus: (signal?: AbortSignal) => Promise<EvolinkTaskDetail>,
    ) => {
      // Abort any previous poll
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setTask({ taskId, status: 'pending', progress: 0, error: null, resultUrl: null });

      try {
        const result = await pollTask(
          (signal) => getStatus(signal),
          {
            signal: controller.signal,
            onProgress: (detail) => {
              setTask({
                status: detail.status,
                progress: detail.progress,
              });
            },
          },
        );

        if (result.status === 'completed') {
          const url =
            result.output?.video_url ??
            result.output?.image_url ??
            result.output?.image_urls?.[0] ??
            null;
          setTask({ status: 'completed', progress: 100, resultUrl: url });
          return url;
        }

        // Failed
        const errorMsg =
          result.error?.message ?? 'Generation failed. Please try again.';
        setTask({ status: 'failed', error: errorMsg });
        return null;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setTask({ status: 'cancelled', error: null });
          return null;
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        setTask({ status: 'failed', error: message });
        return null;
      }
    },
    [setTask],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTask({ ...IDLE_TASK });
  }, [setTask]);

  return { startPolling, cancel };
}
