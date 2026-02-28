import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useSettingsStore } from '@/features/editor/deps/settings';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('AutoSave');

interface UseAutoSaveOptions {
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Function to call when auto-saving */
  onSave: () => Promise<void>;
  /** Whether auto-save is enabled (can be used to disable during export, etc.) */
  enabled?: boolean;
}

/**
 * Hook that automatically saves at the configured interval when there are unsaved changes.
 *
 * Reads `autoSaveInterval` from settings store (in minutes, 0 = disabled).
 * Only triggers save when `isDirty` is true to avoid unnecessary saves.
 *
 * @example
 * useAutoSave({
 *   isDirty,
 *   onSave: handleSave,
 * });
 */
export function useAutoSave({ isDirty, onSave, enabled = true }: UseAutoSaveOptions) {
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const isSavingRef = useRef(false);

  useEffect(() => {
    // Auto-save disabled if interval is 0 or hook is disabled
    if (autoSaveInterval === 0 || !enabled) {
      return;
    }

    const intervalMs = autoSaveInterval * 60 * 1000; // Convert minutes to ms

    let idleCallbackId: number | undefined;

    const intervalId = setInterval(() => {
      // Only save if there are unsaved changes and not already saving
      if (!isDirty || isSavingRef.current) {
        return;
      }

      // Defer save to idle time so it doesn't interrupt active editing (e.g., dragging).
      // timeout ensures save still fires within 10s even under continuous activity.
      idleCallbackId = requestIdleCallback(
        async () => {
          if (isSavingRef.current) return;
          isSavingRef.current = true;
          logger.debug(`Auto-saving (interval: ${autoSaveInterval}m)...`);

          try {
            await onSave();
            logger.debug('Auto-save completed');
          } catch (error) {
            logger.error('Auto-save failed:', error);
            toast.error('Auto-save failed');
          } finally {
            isSavingRef.current = false;
          }
        },
        { timeout: 10_000 }
      );
    }, intervalMs);

    return () => {
      clearInterval(intervalId);
      if (idleCallbackId !== undefined) cancelIdleCallback(idleCallbackId);
    };
  }, [autoSaveInterval, isDirty, onSave, enabled]);
}

