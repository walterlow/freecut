import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrackRowFrame } from './track-row-frame';

describe('TrackRowFrame', () => {
  it('renders a divider for every wrapped row, including the last row', () => {
    render(
      <>
        <TrackRowFrame>
          <div>Video</div>
        </TrackRowFrame>
        <TrackRowFrame>
          <div>Audio</div>
        </TrackRowFrame>
      </>
    );

    expect(screen.getAllByTestId('track-row-divider')).toHaveLength(2);
  });

  it('anchors the divider to the row and keeps it out of hit testing', () => {
    const { container } = render(
      <TrackRowFrame>
        <div>Track</div>
      </TrackRowFrame>
    );

    const row = container.firstElementChild as HTMLDivElement | null;
    const divider = screen.getByTestId('track-row-divider');

    expect(row?.className).toContain('relative');
    expect(divider.className).toContain('pointer-events-none');
    expect(divider.className).toContain('bottom-0');
  });
});
