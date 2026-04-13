import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getAudioEqSettings, resolveAudioEqSettings } from '@/shared/utils/audio-eq';
import { AudioEqCurveEditor } from './audio-eq-curve-editor';

const DEFAULT_SETTINGS = resolveAudioEqSettings({});

describe('AudioEqCurveEditor', () => {
  it('drags a parametric band handle with live preview and final commit', () => {
    const onLiveChange = vi.fn();
    const onChange = vi.fn();

    render(
      <AudioEqCurveEditor
        settings={DEFAULT_SETTINGS}
        onLiveChange={onLiveChange}
        onChange={onChange}
      />,
    );

    const root = document.querySelector('[data-eq-curve-root="true"]') as HTMLDivElement | null;
    const highMidHandle = document.querySelector('[data-eq-band="high-mid"]') as HTMLButtonElement | null;

    expect(root).not.toBeNull();
    expect(highMidHandle).not.toBeNull();

    Object.defineProperty(root!, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 10,
        top: 10,
        bottom: 150,
        left: 0,
        right: 320,
        width: 320,
        height: 140,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(root!, 'setPointerCapture', { value: vi.fn(), configurable: true });
    Object.defineProperty(root!, 'releasePointerCapture', { value: vi.fn(), configurable: true });

    fireEvent.pointerDown(highMidHandle!, { pointerId: 1, clientX: 280, clientY: 24 });
    fireEvent.pointerMove(root!, { pointerId: 1, clientX: 180, clientY: 122 });
    fireEvent.pointerUp(root!, { pointerId: 1, clientX: 180, clientY: 122 });

    expect(onLiveChange).toHaveBeenCalled();
    expect(onLiveChange.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      audioEqHighMidFrequencyHz: expect.any(Number),
      audioEqHighMidGainDb: expect.any(Number),
    }));
    expect(onLiveChange.mock.calls[0]?.[0].audioEqHighMidGainDb).toBeGreaterThan(12);
    expect(onLiveChange.mock.calls.at(-1)?.[0].audioEqHighMidGainDb).toBeLessThan(-10);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      audioEqHighMidFrequencyHz: expect.any(Number),
      audioEqHighMidGainDb: expect.any(Number),
    }));
  });

  it('shows mixed-state messaging and blocks interaction when disabled', () => {
    const onLiveChange = vi.fn();
    const onChange = vi.fn();

    render(
      <AudioEqCurveEditor
        settings={DEFAULT_SETTINGS}
        disabled={true}
        onLiveChange={onLiveChange}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Mixed EQ values')).toBeInTheDocument();

    const lowCutHandle = document.querySelector('[data-eq-band="low-cut"]') as HTMLButtonElement | null;
    fireEvent.pointerDown(lowCutHandle!, { pointerId: 2, clientX: 24, clientY: 120 });

    expect(onLiveChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders Resolve-style numbered band dots', () => {
    render(
      <AudioEqCurveEditor
        settings={DEFAULT_SETTINGS}
        onLiveChange={() => undefined}
        onChange={() => undefined}
      />,
    );

    expect(document.querySelector('[data-eq-band="low-cut"] [data-eq-band-number="1"]')).not.toBeNull();
    expect(document.querySelector('[data-eq-band="high-mid"] [data-eq-band-number="4"]')).not.toBeNull();
    expect(document.querySelector('[data-eq-band="high-cut"] [data-eq-band-number="6"]')).not.toBeNull();
    expect(document.querySelector('[data-eq-band="mid"]')).toBeNull();
    expect(screen.getByText('-80')).toBeInTheDocument();
  });

  it('lets gain bands move across the full EQ span instead of staying in fixed lanes', () => {
    const onLiveChange = vi.fn();
    const onChange = vi.fn();

    render(
      <AudioEqCurveEditor
        settings={DEFAULT_SETTINGS}
        onLiveChange={onLiveChange}
        onChange={onChange}
      />,
    );

    const root = document.querySelector('[data-eq-curve-root="true"]') as HTMLDivElement | null;
    const lowHandle = document.querySelector('[data-eq-band="low"]') as HTMLButtonElement | null;

    expect(root).not.toBeNull();
    expect(lowHandle).not.toBeNull();

    Object.defineProperty(root!, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 10,
        top: 10,
        bottom: 150,
        left: 0,
        right: 320,
        width: 320,
        height: 140,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(root!, 'setPointerCapture', { value: vi.fn(), configurable: true });
    Object.defineProperty(root!, 'releasePointerCapture', { value: vi.fn(), configurable: true });

    fireEvent.pointerDown(lowHandle!, { pointerId: 7, clientX: 120, clientY: 70 });
    fireEvent.pointerMove(root!, { pointerId: 7, clientX: 300, clientY: 70 });
    fireEvent.pointerUp(root!, { pointerId: 7, clientX: 300, clientY: 70 });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      audioEqLowFrequencyHz: expect.any(Number),
    }));
    expect(onChange.mock.calls[0]?.[0].audioEqLowFrequencyHz).toBeGreaterThan(10000);
  });

  it('keeps untouched handles fixed while a band is being dragged', () => {
    function Harness() {
      const [settings, setSettings] = useState(resolveAudioEqSettings({
        highGainDb: 0,
        highFrequencyHz: 6000,
      }));

      return (
        <AudioEqCurveEditor
          settings={settings}
          onLiveChange={(patch) => {
            setSettings((current) => resolveAudioEqSettings({
              ...current,
              ...getAudioEqSettings(patch),
              highGainDb: 6,
              highFrequencyHz: 2000,
            }));
          }}
          onChange={() => undefined}
        />
      );
    }

    render(<Harness />);

    const root = document.querySelector('[data-eq-curve-root="true"]') as HTMLDivElement | null;
    const lowMidHandle = document.querySelector('[data-eq-band="low-mid"]') as HTMLButtonElement | null;
    const highHandle = document.querySelector('[data-eq-band="high"]') as HTMLButtonElement | null;

    expect(root).not.toBeNull();
    expect(lowMidHandle).not.toBeNull();
    expect(highHandle).not.toBeNull();

    Object.defineProperty(root!, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 10,
        top: 10,
        bottom: 150,
        left: 0,
        right: 320,
        width: 320,
        height: 140,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(root!, 'setPointerCapture', { value: vi.fn(), configurable: true });
    Object.defineProperty(root!, 'releasePointerCapture', { value: vi.fn(), configurable: true });

    const initialLeft = highHandle!.style.left;
    const initialTop = highHandle!.style.top;

    fireEvent.pointerDown(lowMidHandle!, { pointerId: 9, clientX: 140, clientY: 70 });
    fireEvent.pointerMove(root!, { pointerId: 9, clientX: 200, clientY: 40 });

    expect(highHandle!.style.left).toBe(initialLeft);
    expect(highHandle!.style.top).toBe(initialTop);
  });
});
