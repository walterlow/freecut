import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DopesheetEditor } from './index';

describe('DopesheetEditor value input commits', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  function renderEditor(onPropertyValueCommit = vi.fn()) {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        propertyValues={{ x: 100 }}
        currentFrame={12}
        width={640}
        height={240}
        onPropertyValueCommit={onPropertyValueCommit}
      />
    );

    return screen.getByRole('spinbutton', { name: 'X Position value at playhead' });
  }

  it('does not allow blur commits to create a keyframe', () => {
    const onPropertyValueCommit = vi.fn();
    const input = renderEditor(onPropertyValueCommit);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.blur(input);

    expect(onPropertyValueCommit).toHaveBeenCalledTimes(1);
    expect(onPropertyValueCommit).toHaveBeenCalledWith('x', 120, { allowCreate: false });
  });

  it('only allows keyframe creation when Enter is pressed', () => {
    const onPropertyValueCommit = vi.fn();
    const input = renderEditor(onPropertyValueCommit);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onPropertyValueCommit).toHaveBeenCalledTimes(1);
    expect(onPropertyValueCommit).toHaveBeenCalledWith('x', 120, { allowCreate: true });
  });

  it('allows blur commits to create a keyframe when row auto-key is enabled', () => {
    const onPropertyValueCommit = vi.fn();
    const input = renderEditor(onPropertyValueCommit);

    fireEvent.click(screen.getByRole('button', { name: /enable auto-key for x position/i }));
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.blur(input);

    expect(onPropertyValueCommit).toHaveBeenCalledTimes(1);
    expect(onPropertyValueCommit).toHaveBeenCalledWith('x', 120, { allowCreate: true });
  });
});
