import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AudioMixerView } from './audio-mixer-view';

vi.mock('@/shared/ui/editor-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/ui/editor-layout')>();
  return {
    ...actual,
    EDITOR_LAYOUT_CSS_VALUES: {
      ...actual.EDITOR_LAYOUT_CSS_VALUES,
      timelineMixerWidth: 280,
      timelineTracksHeaderHeight: 44,
    },
  };
});

describe('AudioMixerView', () => {
  it('shows scanning fallback bars while waveform data is unresolved', () => {
    const { container } = render(
      <AudioMixerView
        tracks={[
          {
            id: 'track-1',
            name: 'A1',
            kind: 'audio',
            muted: false,
            solo: false,
            volume: 0,
            itemIds: [],
          },
        ]}
        perTrackLevels={new Map([
          ['track-1', {
            left: 0,
            right: 0,
            unresolvedSourceCount: 1,
            resolvedSourceCount: 0,
          }],
        ])}
        masterEstimate={{
          left: 0,
          right: 0,
          unresolvedSourceCount: 1,
          resolvedSourceCount: 0,
        }}
        isPlaying
        onTrackVolumeChange={() => undefined}
        onTrackMuteToggle={() => undefined}
        onTrackSoloToggle={() => undefined}
      />,
    );

    const trackLeft = container.querySelector('[data-track-id="track-1"][data-track-channel="left"]');
    const busLeft = container.querySelector('[data-bus-channel="left"]');

    expect(trackLeft).not.toBeNull();
    expect(trackLeft).toHaveStyle({ height: '18%' });
    expect(busLeft).not.toBeNull();
    expect(busLeft).toHaveStyle({ height: '18%' });
  });

  it('does not jump the volume to silence when dragging from the thumb', () => {
    const handleTrackVolumeChange = vi.fn();
    const { container } = render(
      <AudioMixerView
        tracks={[
          {
            id: 'track-1',
            name: 'A1',
            kind: 'audio',
            muted: false,
            solo: false,
            volume: 0,
            itemIds: ['item-1'],
          },
        ]}
        perTrackLevels={new Map()}
        masterEstimate={{
          left: 0,
          right: 0,
          unresolvedSourceCount: 0,
          resolvedSourceCount: 0,
        }}
        isPlaying
        onTrackVolumeChange={handleTrackVolumeChange}
        onTrackMuteToggle={() => undefined}
        onTrackSoloToggle={() => undefined}
      />,
    );

    const faderRoot = container.querySelector('[data-track-id="track-1"][data-fader-root="true"]') as HTMLDivElement | null;
    expect(faderRoot).not.toBeNull();

    Object.defineProperty(faderRoot!, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 20,
        top: 20,
        bottom: 220,
        left: 0,
        right: 20,
        width: 20,
        height: 200,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(faderRoot!, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(faderRoot!, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    });

    // Drag: knob moves imperatively, no store writes
    fireEvent.pointerDown(faderRoot!, { pointerId: 1, clientY: 53.5 });
    fireEvent.pointerMove(faderRoot!, { pointerId: 1, clientY: 43.5 });
    expect(handleTrackVolumeChange).not.toHaveBeenCalled();

    // Release: single store commit with final volume
    fireEvent.pointerUp(faderRoot!, { pointerId: 1, clientY: 43.5 });
    expect(handleTrackVolumeChange).toHaveBeenCalledTimes(1);
    const committedVolume = handleTrackVolumeChange.mock.calls[0]?.[1];
    expect(committedVolume).toBeGreaterThan(-10);
  });
});
