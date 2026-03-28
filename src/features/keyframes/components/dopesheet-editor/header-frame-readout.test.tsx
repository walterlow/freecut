import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DopesheetEditor } from './index';

const KEYFRAMES = {
  x: [
    { id: 'kf-x-1', frame: 20, value: 100, easing: 'linear' as const },
    { id: 'kf-x-2', frame: 28, value: 140, easing: 'linear' as const },
  ],
  y: [
    { id: 'kf-y-1', frame: 20, value: 200, easing: 'linear' as const },
  ],
};

describe('DopesheetEditor header frame inputs', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  function renderEditor(props?: Partial<ComponentProps<typeof DopesheetEditor>>) {
    const onKeyframeMove = vi.fn();
    const onNavigateToKeyframe = vi.fn();

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={KEYFRAMES}
        currentFrame={12}
        globalFrame={42}
        totalFrames={120}
        width={640}
        height={240}
        onKeyframeMove={onKeyframeMove}
        onNavigateToKeyframe={onNavigateToKeyframe}
        {...props}
      />
    );

    return { onKeyframeMove, onNavigateToKeyframe };
  }

  it('shows the selected keyframe local and global frame values', () => {
    renderEditor({
      selectedKeyframeIds: new Set(['kf-x-1']),
    });

    expect(screen.getByLabelText('Local frame')).toHaveValue(20);
    expect(screen.getByLabelText('Global frame')).toHaveValue(50);
  });

  it('shows mixed selections as blank inputs with a dash placeholder', () => {
    renderEditor({
      selectedKeyframeIds: new Set(['kf-x-1', 'kf-x-2']),
    });

    const localInput = screen.getByLabelText('Local frame') as HTMLInputElement;
    const globalInput = screen.getByLabelText('Global frame') as HTMLInputElement;

    expect(localInput.value).toBe('');
    expect(localInput).toHaveAttribute('placeholder', '-');
    expect(localInput).toBeDisabled();

    expect(globalInput.value).toBe('');
    expect(globalInput).toHaveAttribute('placeholder', '-');
    expect(globalInput).toBeDisabled();
  });

  it('moves the selected keyframe when the local frame input is edited', () => {
    const { onKeyframeMove, onNavigateToKeyframe } = renderEditor({
      selectedKeyframeIds: new Set(['kf-x-1']),
    });

    const input = screen.getByLabelText('Local frame');
    fireEvent.change(input, { target: { value: '24' } });
    fireEvent.blur(input);

    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-1' },
      24,
      100
    );
    expect(onNavigateToKeyframe).toHaveBeenCalledWith(24);
  });

  it('clamps the local frame input before the next keyframe so frames cannot cross', () => {
    const { onKeyframeMove, onNavigateToKeyframe } = renderEditor({
      selectedKeyframeIds: new Set(['kf-x-1']),
    });

    const input = screen.getByLabelText('Local frame');
    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.blur(input);

    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-1' },
      27,
      100
    );
    expect(onNavigateToKeyframe).toHaveBeenCalledWith(27);
    expect(input).toHaveValue(27);
  });

  it('moves selected same-frame keyframes together when the global frame input is edited', () => {
    const { onKeyframeMove, onNavigateToKeyframe } = renderEditor({
      selectedKeyframeIds: new Set(['kf-x-1', 'kf-y-1']),
    });

    const input = screen.getByLabelText('Global frame');
    fireEvent.change(input, { target: { value: '55' } });
    fireEvent.blur(input);

    expect(onKeyframeMove).toHaveBeenCalledTimes(2);
    expect(onKeyframeMove).toHaveBeenNthCalledWith(
      1,
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-1' },
      25,
      100
    );
    expect(onKeyframeMove).toHaveBeenNthCalledWith(
      2,
      { itemId: 'item-1', property: 'y', keyframeId: 'kf-y-1' },
      25,
      200
    );
    expect(onNavigateToKeyframe).toHaveBeenCalledWith(25);
  });
});
