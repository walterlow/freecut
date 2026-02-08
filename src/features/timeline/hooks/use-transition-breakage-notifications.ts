import { useEffect, useRef } from 'react';
import { useTimelineStore } from '../stores/timeline-store';
import type { TimelineState, TimelineActions } from '../types';
import type { TransitionBreakage } from '@/types/transition';

/**
 * Hook that monitors pendingBreakages state and shows notifications
 * when transitions are automatically removed due to clip changes.
 *
 * This hook should be mounted once in the editor root component.
 *
 * Currently logs to console. Future enhancement: integrate with a toast library.
 */
export function useTransitionBreakageNotifications() {
  const pendingBreakages = useTimelineStore(
    (s: TimelineState) => s.pendingBreakages
  );
  const clearPendingBreakages = useTimelineStore(
    (s: TimelineActions) => s.clearPendingBreakages
  );

  // Track previous length to detect new breakages
  const prevLengthRef = useRef(0);

  useEffect(() => {
    // Only process if there are new breakages
    if (pendingBreakages.length === 0) {
      prevLengthRef.current = 0;
      return;
    }

    // Only show notification for new breakages (not on initial mount with existing)
    if (pendingBreakages.length === prevLengthRef.current) {
      return;
    }

    // Get only new breakages
    const newBreakages = pendingBreakages.slice(prevLengthRef.current);
    prevLengthRef.current = pendingBreakages.length;

    if (newBreakages.length === 0) return;

    // Show notification
    showBreakageNotification(newBreakages);

    // Clear after showing (with small delay to allow undo action if implemented)
    const timeout = setTimeout(() => {
      clearPendingBreakages();
      prevLengthRef.current = 0;
    }, 100);

    return () => clearTimeout(timeout);
  }, [pendingBreakages, clearPendingBreakages]);
}

/**
 * Show notification for transition breakages.
 * Currently uses console.warn. Can be replaced with toast library.
 */
function showBreakageNotification(breakages: TransitionBreakage[]) {
  if (breakages.length === 1) {
    const breakage = breakages[0]!;
    console.warn(`[Transition] ${breakage.message}`);
  } else {
    console.warn(
      `[Transition] ${breakages.length} transitions removed due to clip changes`
    );
    for (const breakage of breakages) {
      console.warn(`  - ${breakage.message}`);
    }
  }
}
