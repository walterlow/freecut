import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DopesheetEditor } from './index';

describe('DopesheetEditor property groups', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  function renderEditor(overrides: Partial<ComponentProps<typeof DopesheetEditor>> = {}) {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [], volume: [] }}
        propertyValues={{ x: 100, volume: -6 }}
        currentFrame={12}
        width={640}
        height={240}
        {...overrides}
      />
    );
  }

  it('renders accordion-style groups and collapses their rows', () => {
    renderEditor();

    expect(screen.getByRole('button', { name: /collapse transform/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /collapse audio/i })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: /volume \(db\) value at playhead/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /collapse transform/i }));

    expect(screen.queryByRole('spinbutton', { name: /x position value at playhead/i })).toBeNull();
    expect(screen.getByRole('button', { name: /expand transform/i })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: /volume \(db\) value at playhead/i })).toBeTruthy();
  });

  it('filters parameter groups from the menu', () => {
    renderEditor();

    fireEvent.pointerDown(screen.getByRole('button', { name: /parameter display options/i }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByText(/display audio parameters/i));

    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i, hidden: true })).toBeTruthy();
    expect(screen.queryByRole('spinbutton', { name: /volume \(db\) value at playhead/i, hidden: true })).toBeNull();
  });

  it('adds keyframes for every property in a group', () => {
    const onAddKeyframe = vi.fn();
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      onAddKeyframe,
    });

    fireEvent.click(screen.getByRole('button', { name: /toggle transform keyframes at playhead/i }));

    expect(onAddKeyframe).toHaveBeenCalledTimes(2);
    expect(onAddKeyframe).toHaveBeenNthCalledWith(1, 'x', 12);
    expect(onAddKeyframe).toHaveBeenNthCalledWith(2, 'y', 12);
  });

  it('locks a row and disables its edit controls', () => {
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      onAddKeyframe: vi.fn(),
      onPropertyValueCommit: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: /lock x position row/i }));

    expect(screen.getByRole('button', { name: /unlock x position row/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /toggle x position keyframe at playhead/i })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: /y position value at playhead/i })).not.toBeDisabled();
  });

  it('uses the curve button to toggle graph property visibility', () => {
    const onPropertyChange = vi.fn();
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      visualizationMode: 'graph',
      onPropertyChange,
    });

    expect(screen.getByRole('button', { name: /show x position curve/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /show y position curve/i })).toHaveAttribute('aria-pressed', 'false');

    // Turning Y on makes it the active curve
    fireEvent.click(screen.getByRole('button', { name: /show y position curve/i }));
    expect(onPropertyChange).toHaveBeenCalledWith('y');
  });

  it('keeps visibility toggles when selecting a different active row in graph mode', () => {
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kf-x', frame: 10, value: 100, easing: 'linear' }],
        y: [{ id: 'kf-y', frame: 20, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
      visualizationMode: 'graph',
      onPropertyChange: vi.fn(),
    });

    const yToggle = screen.getByRole('button', { name: /show y position curve/i });
    fireEvent.click(yToggle);
    expect(yToggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByText('X Position'));

    expect(yToggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows interpolation icon controls only in graph view', () => {
    const interpolationOptions = [
      { value: 'linear' as const, label: 'Linear' },
      { value: 'ease-in' as const, label: 'Ease In' },
    ];
    const onInterpolationChange = vi.fn();

    const { rerender } = render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        propertyValues={{ x: 100 }}
        currentFrame={12}
        width={640}
        height={240}
        visualizationMode="graph"
        selectedInterpolation="linear"
        interpolationOptions={interpolationOptions}
        onInterpolationChange={onInterpolationChange}
      />
    );

    expect(screen.getByRole('button', { name: /set interpolation to linear/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /set interpolation to ease in/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /set interpolation to ease in/i }));
    expect(onInterpolationChange).toHaveBeenCalledWith('ease-in');

    rerender(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        propertyValues={{ x: 100 }}
        currentFrame={12}
        width={640}
        height={240}
        visualizationMode="dopesheet"
        selectedInterpolation="linear"
        interpolationOptions={interpolationOptions}
        onInterpolationChange={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /set interpolation to linear/i })).toBeNull();
  });

  it('deletes selected keyframes from the graph pane without bubbling to parent shortcuts', () => {
    const onRemoveKeyframes = vi.fn();
    const onParentKeyDown = vi.fn();

    render(
      <div onKeyDown={onParentKeyDown}>
        <DopesheetEditor
          itemId="item-1"
          keyframesByProperty={{
            x: [{ id: 'kf-1', frame: 12, value: 100, easing: 'linear' }],
          }}
          propertyValues={{ x: 100 }}
          currentFrame={12}
          width={640}
          height={240}
          visualizationMode="graph"
          selectedKeyframeIds={new Set(['kf-1'])}
          onRemoveKeyframes={onRemoveKeyframes}
        />
      </div>
    );

    fireEvent.keyDown(screen.getByTestId('dopesheet-graph-pane'), { key: 'Delete' });

    expect(onRemoveKeyframes).toHaveBeenCalledWith([
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-1' },
    ]);
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it('shows graph options for ruler units and handle visibility', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [
            {
              id: 'kf-1',
              frame: 0,
              value: 100,
              easing: 'ease-in',
              easingConfig: {
                type: 'cubic-bezier',
                bezier: { x1: 0.42, y1: 0, x2: 1, y2: 1 },
              },
            },
            {
              id: 'kf-2',
              frame: 30,
              value: 200,
              easing: 'linear',
            },
          ],
        }}
        propertyValues={{ x: 100 }}
        currentFrame={12}
        totalFrames={60}
        fps={30}
        width={640}
        height={240}
        visualizationMode="graph"
        selectedProperty="x"
        selectedKeyframeIds={new Set(['kf-1'])}
      />
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: /graph view options/i }), { button: 0, ctrlKey: false });
    expect(screen.getByText(/display time ruler in seconds/i)).toBeTruthy();
    expect(screen.getByText(/display time ruler in frames/i)).toBeTruthy();
    expect(screen.getByText(/show all handles/i)).toBeTruthy();
  });

  it('renders clipboard controls in the bottom row', () => {
    renderEditor({
      keyframesByProperty: { x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }] },
      propertyValues: { x: 100 },
      selectedKeyframeIds: new Set(['kx-1']),
      onCopyKeyframes: vi.fn(),
      onCutKeyframes: vi.fn(),
      onPasteKeyframes: vi.fn(),
      hasKeyframeClipboard: true,
      isKeyframeClipboardCut: true,
    });

    expect(screen.getByRole('button', { name: /copy selected keyframes/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /cut selected keyframes/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /move keyframes from clipboard/i })).toBeTruthy();
    expect(screen.getByText('Cut')).toBeTruthy();
  });

  it('shows matching header icons and supports bulk group controls', () => {
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      onPropertyValueCommit: vi.fn(),
    });

    expect(screen.getByRole('button', { name: /show all transform curves/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /lock transform rows/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /enable auto-key for transform/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /lock transform rows/i }));

    expect(screen.getByRole('button', { name: /unlock transform rows/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: /y position value at playhead/i })).toBeDisabled();
  });

  it('clears row and group keyframes', () => {
    const onRemoveKeyframes = vi.fn();
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
        y: [{ id: 'ky-1', frame: 16, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
      onRemoveKeyframes,
    });

    fireEvent.click(screen.getByRole('button', { name: /clear x position keyframes/i }));
    fireEvent.click(screen.getByRole('button', { name: /clear all transform keyframes/i }));

    expect(onRemoveKeyframes).toHaveBeenNthCalledWith(1, [
      { itemId: 'item-1', property: 'x', keyframeId: 'kx-1' },
    ]);
    expect(onRemoveKeyframes).toHaveBeenNthCalledWith(2, [
      { itemId: 'item-1', property: 'x', keyframeId: 'kx-1' },
      { itemId: 'item-1', property: 'y', keyframeId: 'ky-1' },
    ]);
  });

  it('navigates group keyframes with the header arrows', () => {
    const onNavigateToKeyframe = vi.fn();
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
        y: [{ id: 'ky-1', frame: 16, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
      onNavigateToKeyframe,
    });

    fireEvent.click(screen.getByRole('button', { name: /previous transform keyframe/i }));
    fireEvent.click(screen.getByRole('button', { name: /next transform keyframe/i }));

    expect(onNavigateToKeyframe).toHaveBeenNthCalledWith(1, 8);
    expect(onNavigateToKeyframe).toHaveBeenNthCalledWith(2, 16);
  });
});
