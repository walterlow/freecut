import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const useClockFrameMock = vi.fn(() => 0);

vi.mock('../clock', () => ({
  useClockFrame: () => useClockFrameMock(),
}));

import { Sequence } from './Sequence';

describe('Sequence', () => {
  it('keeps children mounted during postmount runway while hidden', () => {
    useClockFrameMock.mockReturnValue(15);

    render(
      <Sequence from={10} durationInFrames={5} postmountFor={3}>
        <div data-testid="child">content</div>
      </Sequence>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByTestId('child').parentElement).toHaveStyle({ visibility: 'hidden' });
  });

  it('unmounts children after the postmount runway ends', () => {
    useClockFrameMock.mockReturnValue(18);

    render(
      <Sequence from={10} durationInFrames={5} postmountFor={3}>
        <div data-testid="child">content</div>
      </Sequence>,
    );

    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });
});
