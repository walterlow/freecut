import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SegmentStatusOverlays } from './segment-status-overlays';

describe('SegmentStatusOverlays', () => {
  it('renders overlay labels with progress percentages', () => {
    render(
      <SegmentStatusOverlays
        overlays={[
          { id: 'captions', label: 'Generating captions', progress: 42, tone: 'info' },
        ]}
      />
    );

    expect(screen.getByText('Generating captions')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('supports overlays without progress for future segment states', () => {
    render(
      <SegmentStatusOverlays
        overlays={[
          { id: 'sync', label: 'Syncing segment', tone: 'warning' },
        ]}
      />
    );

    expect(screen.getByText('Syncing segment')).toBeInTheDocument();
  });
});
