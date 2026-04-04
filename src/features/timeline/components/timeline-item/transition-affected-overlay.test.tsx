import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TransitionAffectedOverlay } from './transition-affected-overlay';

describe('TransitionAffectedOverlay', () => {
  it('renders incoming and outgoing transition spans using clip-relative geometry', () => {
    render(
      <TransitionAffectedOverlay
        clipDurationInFrames={100}
        clipWidth={200}
        ranges={[
          {
            key: 'incoming',
            start: 0,
            end: 30,
            role: 'incoming',
            label: 'Incoming transition range',
          },
          {
            key: 'outgoing',
            start: 70,
            end: 100,
            role: 'outgoing',
            label: 'Outgoing transition range',
          },
        ]}
      />,
    );

    const incoming = screen.getByTitle('Incoming transition range');
    const outgoing = screen.getByTitle('Outgoing transition range');

    expect(incoming).toHaveStyle({ left: '0px', width: '60px' });
    expect(outgoing).toHaveStyle({ left: '140px', width: '60px' });
    expect(incoming).toHaveAttribute('data-transition-affected-role', 'incoming');
    expect(outgoing).toHaveAttribute('data-transition-affected-role', 'outgoing');
  });
});
