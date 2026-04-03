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
        masterVolumeDb={0}
        masterMuted={false}
        onMasterVolumeChange={() => undefined}
        onMasterMuteToggle={() => undefined}
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
        masterVolumeDb={0}
        masterMuted={false}
        onMasterVolumeChange={() => undefined}
        onMasterMuteToggle={() => undefined}
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

    // Release: synchronous in-place mutation commit (no composition re-render)
    fireEvent.pointerUp(faderRoot!, { pointerId: 1, clientY: 43.5 });
    expect(handleTrackVolumeChange).toHaveBeenCalledTimes(1);
    const committedVolume = handleTrackVolumeChange.mock.calls[0]?.[1];
    expect(committedVolume).toBeGreaterThan(-10);
  });

  it('keeps empty channel meters flat while dragging the fader', () => {
    const props = {
      tracks: [
        {
          id: 'track-1',
          name: 'A2',
          kind: 'audio' as const,
          muted: false,
          solo: false,
          volume: 0,
          itemIds: [],
        },
      ],
      perTrackLevels: new Map(),
      masterEstimate: {
        left: 0,
        right: 0,
        unresolvedSourceCount: 0,
        resolvedSourceCount: 0,
      },
      isPlaying: true,
      onTrackVolumeChange: () => undefined,
      onTrackMuteToggle: () => undefined,
      onTrackSoloToggle: () => undefined,
      masterVolumeDb: 0,
      masterMuted: false,
      onMasterVolumeChange: () => undefined,
      onMasterMuteToggle: () => undefined,
    };

    const { container, rerender } = render(<AudioMixerView {...props} />);

    const faderRoot = container.querySelector('[data-track-id="track-1"][data-fader-root="true"]') as HTMLDivElement | null;
    expect(faderRoot).not.toBeNull();
    expect(container.querySelector('[data-track-id="track-1"][data-track-channel="left"]')).toHaveStyle({ height: '0%' });

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

    fireEvent.pointerDown(faderRoot!, { pointerId: 1, clientY: 53.5 });
    fireEvent.pointerMove(faderRoot!, { pointerId: 1, clientY: 20 });

    rerender(<AudioMixerView {...props} />);

    expect(container.querySelector('[data-track-id="track-1"][data-track-channel="left"]')).toHaveStyle({ height: '0%' });
    expect(container.querySelector('[data-track-id="track-1"][data-track-channel="right"]')).toHaveStyle({ height: '0%' });
  });

  it('keeps zero-level meter entries flat while dragging during playback', () => {
    const props = {
      tracks: [
        {
          id: 'track-1',
          name: 'A2',
          kind: 'audio' as const,
          muted: false,
          solo: false,
          volume: 0,
          itemIds: ['item-1'],
        },
      ],
      perTrackLevels: new Map([
        ['track-1', {
          left: 0,
          right: 0,
          unresolvedSourceCount: 0,
          resolvedSourceCount: 0,
        }],
      ]),
      masterEstimate: {
        left: 0,
        right: 0,
        unresolvedSourceCount: 0,
        resolvedSourceCount: 0,
      },
      isPlaying: true,
      onTrackVolumeChange: () => undefined,
      onTrackMuteToggle: () => undefined,
      onTrackSoloToggle: () => undefined,
      masterVolumeDb: 0,
      masterMuted: false,
      onMasterVolumeChange: () => undefined,
      onMasterMuteToggle: () => undefined,
    };

    const { container, rerender } = render(<AudioMixerView {...props} />);

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

    fireEvent.pointerDown(faderRoot!, { pointerId: 1, clientY: 53.5 });
    fireEvent.pointerMove(faderRoot!, { pointerId: 1, clientY: 20 });

    rerender(<AudioMixerView {...props} />);

    expect(container.querySelector('[data-track-id="track-1"][data-track-channel="left"]')).toHaveStyle({ height: '0%' });
    expect(container.querySelector('[data-track-id="track-1"][data-track-channel="right"]')).toHaveStyle({ height: '0%' });
  });

  it('updates channel meters when estimation pipeline delivers new levels', () => {
    const props = {
      tracks: [
        {
          id: 'track-1',
          name: 'A2',
          kind: 'audio' as const,
          muted: false,
          solo: false,
          volume: 0,
          itemIds: ['item-1'],
        },
      ],
      perTrackLevels: new Map([
        ['track-1', {
          left: 0.1,
          right: 0.08,
          unresolvedSourceCount: 0,
          resolvedSourceCount: 1,
        }],
      ]),
      masterEstimate: {
        left: 0,
        right: 0,
        unresolvedSourceCount: 0,
        resolvedSourceCount: 0,
      },
      isPlaying: true,
      onTrackVolumeChange: () => undefined,
      onTrackMuteToggle: () => undefined,
      onTrackSoloToggle: () => undefined,
      masterVolumeDb: 0,
      masterMuted: false,
      onMasterVolumeChange: () => undefined,
      onMasterMuteToggle: () => undefined,
    };

    const { container, rerender } = render(<AudioMixerView {...props} />);

    const leftBar = container.querySelector('[data-track-id="track-1"][data-track-channel="left"]') as HTMLDivElement | null;
    expect(leftBar).not.toBeNull();
    const initialHeight = parseFloat(leftBar!.style.height);

    // Simulate the estimation pipeline delivering boosted levels (e.g. after
    // a fader drag triggers setLiveTrackVolumeOverride → pipeline recalc).
    rerender(
      <AudioMixerView
        {...props}
        perTrackLevels={new Map([
          ['track-1', {
            left: 0.5,
            right: 0.4,
            unresolvedSourceCount: 0,
            resolvedSourceCount: 1,
          }],
        ])}
      />,
    );

    expect(parseFloat(leftBar!.style.height)).toBeGreaterThan(initialHeight);
  });

  it('does not double-count meter levels when pipeline updates mid-drag', () => {
    // Regression: the old offset-based preview added a dB offset on top of
    // base levels that already included the live fader override from the
    // estimation pipeline, causing meters to overshoot.
    const props = {
      tracks: [
        {
          id: 'track-1',
          name: 'A1',
          kind: 'audio' as const,
          muted: false,
          solo: false,
          volume: 0,
          itemIds: ['item-1'],
        },
      ],
      perTrackLevels: new Map([
        ['track-1', {
          left: 0.1,
          right: 0.1,
          unresolvedSourceCount: 0,
          resolvedSourceCount: 1,
        }],
      ]),
      masterEstimate: { left: 0, right: 0, unresolvedSourceCount: 0, resolvedSourceCount: 0 },
      isPlaying: true,
      onTrackVolumeChange: () => undefined,
      onTrackMuteToggle: () => undefined,
      onTrackSoloToggle: () => undefined,
      masterVolumeDb: 0,
      masterMuted: false,
      onMasterVolumeChange: () => undefined,
      onMasterMuteToggle: () => undefined,
    };

    const { container, rerender } = render(<AudioMixerView {...props} />);

    const faderRoot = container.querySelector('[data-track-id="track-1"][data-fader-root="true"]') as HTMLDivElement | null;
    const leftBar = container.querySelector('[data-track-id="track-1"][data-track-channel="left"]') as HTMLDivElement | null;
    expect(faderRoot).not.toBeNull();
    expect(leftBar).not.toBeNull();

    Object.defineProperty(faderRoot!, 'getBoundingClientRect', {
      value: () => ({
        x: 0, y: 20, top: 20, bottom: 220, left: 0, right: 20,
        width: 20, height: 200, toJSON: () => ({}),
      }),
    });
    Object.defineProperty(faderRoot!, 'setPointerCapture', { value: vi.fn(), configurable: true });
    Object.defineProperty(faderRoot!, 'releasePointerCapture', { value: vi.fn(), configurable: true });

    // Start a drag to enter the mid-drag path
    fireEvent.pointerDown(faderRoot!, { pointerId: 1, clientY: 53.5 });
    fireEvent.pointerMove(faderRoot!, { pointerId: 1, clientY: 40 });

    // Simulate the estimation pipeline delivering boosted levels mid-drag
    // (as getTrackGainCorrection would bake the fader override into the level).
    const boostedLevel = 0.1 * Math.pow(10, 6 / 20); // ~0.2
    rerender(
      <AudioMixerView
        {...props}
        perTrackLevels={new Map([
          ['track-1', {
            left: boostedLevel,
            right: boostedLevel,
            unresolvedSourceCount: 0,
            resolvedSourceCount: 1,
          }],
        ])}
      />,
    );

    const heightAfterPipeline = parseFloat(leftBar!.style.height);

    // Re-render again with the same levels — height must not change.
    rerender(
      <AudioMixerView
        {...props}
        perTrackLevels={new Map([
          ['track-1', {
            left: boostedLevel,
            right: boostedLevel,
            unresolvedSourceCount: 0,
            resolvedSourceCount: 1,
          }],
        ])}
      />,
    );

    expect(parseFloat(leftBar!.style.height)).toBeCloseTo(heightAfterPipeline, 5);

    // End drag
    fireEvent.pointerUp(faderRoot!, { pointerId: 1, clientY: 40 });
  });

  it('keeps dragging active while meter props rerender during the gesture', () => {
    const handleTrackVolumeChange = vi.fn();
    const props = {
      tracks: [
        {
          id: 'track-1',
          name: 'A2',
          kind: 'audio' as const,
          muted: false,
          solo: false,
          volume: 0,
          itemIds: ['item-1'],
        },
      ],
      perTrackLevels: new Map([
        ['track-1', {
          left: 0.1,
          right: 0.08,
          unresolvedSourceCount: 0,
          resolvedSourceCount: 1,
        }],
      ]),
      masterEstimate: {
        left: 0,
        right: 0,
        unresolvedSourceCount: 0,
        resolvedSourceCount: 0,
      },
      isPlaying: true,
      onTrackVolumeChange: handleTrackVolumeChange,
      onTrackMuteToggle: () => undefined,
      onTrackSoloToggle: () => undefined,
      masterVolumeDb: 0,
      masterMuted: false,
      onMasterVolumeChange: () => undefined,
      onMasterMuteToggle: () => undefined,
    };

    const { container, rerender } = render(<AudioMixerView {...props} />);
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

    fireEvent.pointerDown(faderRoot!, { pointerId: 1, clientY: 53.5 });
    rerender(<AudioMixerView
      {...props}
      perTrackLevels={new Map([
        ['track-1', {
          left: 0.12,
          right: 0.1,
          unresolvedSourceCount: 0,
          resolvedSourceCount: 1,
        }],
      ])}
    />);
    fireEvent.pointerMove(faderRoot!, { pointerId: 1, clientY: 20 });

    expect(handleTrackVolumeChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(faderRoot!, { pointerId: 1, clientY: 20 });
    expect(handleTrackVolumeChange).toHaveBeenCalledTimes(1);
  });

  it('commits the dragged value when the pointer is cancelled', () => {
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
        masterVolumeDb={0}
        masterMuted={false}
        onMasterVolumeChange={() => undefined}
        onMasterMuteToggle={() => undefined}
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

    fireEvent.pointerDown(faderRoot!, { pointerId: 1, clientY: 53.5 });
    fireEvent.pointerMove(faderRoot!, { pointerId: 1, clientY: 43.5 });
    fireEvent.pointerCancel(faderRoot!, { pointerId: 1, clientY: 43.5 });

    expect(handleTrackVolumeChange).toHaveBeenCalledTimes(1);
    expect(handleTrackVolumeChange.mock.calls[0]?.[1]).toBeGreaterThan(-10);
  });

  it('commits the dragged value when the mixer unmounts mid-drag', () => {
    const handleTrackVolumeChange = vi.fn();
    const { container, unmount } = render(
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
        masterVolumeDb={0}
        masterMuted={false}
        onMasterVolumeChange={() => undefined}
        onMasterMuteToggle={() => undefined}
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

    fireEvent.pointerDown(faderRoot!, { pointerId: 1, clientY: 53.5 });
    fireEvent.pointerMove(faderRoot!, { pointerId: 1, clientY: 43.5 });
    unmount();

    expect(handleTrackVolumeChange).toHaveBeenCalledTimes(1);
    expect(handleTrackVolumeChange.mock.calls[0]?.[1]).toBeGreaterThan(-10);
  });
});
