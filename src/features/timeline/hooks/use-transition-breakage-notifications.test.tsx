import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

import type { TransitionBreakage } from '@/types/transition';
import {
  clearDomainEventListeners,
  emitDomainEvent,
} from '@/shared/events/domain-events';

import { useTransitionBreakageNotifications } from './use-transition-breakage-notifications';

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
  },
}));

function BreakageNotificationsProbe() {
  useTransitionBreakageNotifications();
  return null;
}

function makeBreakage(message: string): TransitionBreakage {
  return {
    transitionId: crypto.randomUUID(),
    transition: {
      id: crypto.randomUUID(),
      type: 'crossfade',
      leftClipId: 'clip-left',
      rightClipId: 'clip-right',
      trackId: 'track-1',
      durationInFrames: 12,
      presentation: 'fade',
      timing: 'linear',
    },
    reason: 'not_adjacent',
    message,
    affectedClipIds: ['clip-left', 'clip-right'],
  };
}

describe('useTransitionBreakageNotifications', () => {
  afterEach(() => {
    clearDomainEventListeners();
    vi.mocked(toast.warning).mockReset();
  });

  it('shows the breakage message for a single transition breakage event', () => {
    render(<BreakageNotificationsProbe />);

    emitDomainEvent('timeline.transitionBreakagesDetected', {
      breakages: [makeBreakage('Transition removed after trim')],
    });

    expect(toast.warning).toHaveBeenCalledWith('Transition removed after trim');
  });

  it('shows an aggregate warning for multiple transition breakages', () => {
    render(<BreakageNotificationsProbe />);

    emitDomainEvent('timeline.transitionBreakagesDetected', {
      breakages: [
        makeBreakage('Transition A removed'),
        makeBreakage('Transition B removed'),
      ],
    });

    expect(toast.warning).toHaveBeenCalledWith('2 transitions removed due to clip changes');
  });
});
