import { useEffect } from 'react';
import { toast } from 'sonner';
import { onDomainEvent } from '@/shared/events/domain-events';
import type { TransitionBreakage } from '@/types/transition';

/**
 * Hook that subscribes to transition breakage events and shows notifications
 * when transitions are automatically removed due to clip changes.
 *
 * This hook should be mounted once in the editor root component.
 */
export function useTransitionBreakageNotifications() {
  useEffect(() => {
    return onDomainEvent('timeline.transitionBreakagesDetected', ({ breakages }) => {
      if (breakages.length === 0) return;
      showBreakageNotification(breakages);
    });
  }, []);
}

/**
 * Show notification for transition breakages via toast.
 */
function showBreakageNotification(breakages: TransitionBreakage[]) {
  if (breakages.length === 1) {
    const breakage = breakages[0]!;
    toast.warning(breakage.message);
  } else {
    toast.warning(
      `${breakages.length} transitions removed due to clip changes`
    );
  }
}
