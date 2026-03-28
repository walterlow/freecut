import { useState, type ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DopesheetEditor } from './index';

describe('DopesheetEditor property groups', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  beforeEach(() => {
    localStorage.clear();
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

  it('batches group keyframe creation when a multi-add handler is provided', () => {
    const onAddKeyframes = vi.fn();
    const onAddKeyframe = vi.fn();

    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      onAddKeyframe,
      onAddKeyframes,
    });

    fireEvent.click(screen.getByRole('button', { name: /toggle transform keyframes at playhead/i }));

    expect(onAddKeyframe).not.toHaveBeenCalled();
    expect(onAddKeyframes).toHaveBeenCalledWith([
      { property: 'x', frame: 12 },
      { property: 'y', frame: 12 },
    ]);
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

  it('restores graph visibility toggles after remount', () => {
    const props = {
      itemId: 'item-persisted-visibility',
      keyframesByProperty: { x: [], y: [], rotation: [] },
      propertyValues: { x: 100, y: 200, rotation: 15 },
      visualizationMode: 'graph' as const,
    };

    const { unmount } = render(
      <DopesheetEditor
        currentFrame={12}
        width={640}
        height={240}
        {...props}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /show y position curve/i }));
    fireEvent.click(screen.getByRole('button', { name: /show rotation curve/i }));

    unmount();

    render(
      <DopesheetEditor
        currentFrame={12}
        width={640}
        height={240}
        {...props}
      />
    );

    expect(screen.getByRole('button', { name: /show x position curve/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /show y position curve/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /show rotation curve/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a single horizontal zoom slider in the toolbar', () => {
    renderEditor();

    expect(screen.getAllByRole('slider')).toHaveLength(1);
    expect(screen.queryByTitle(/snapping enabled/i)).toBeNull();
  });

  it('shows horizontal and vertical zoom sliders in graph mode', () => {
    renderEditor({
      visualizationMode: 'graph',
      keyframesByProperty: {
        x: [{ id: 'kf-x', frame: 10, value: 100, easing: 'linear' }],
      },
      propertyValues: { x: 100 },
      selectedProperty: 'x',
    });

    expect(screen.getAllByRole('slider')).toHaveLength(2);
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

  it('shows the view options menu in sheet mode too', () => {
    renderEditor({ visualizationMode: 'dopesheet' });

    fireEvent.pointerDown(screen.getByRole('button', { name: /sheet view options/i }), { button: 0, ctrlKey: false });

    expect(screen.getByText(/display time ruler in seconds/i)).toBeTruthy();
    expect(screen.getByText(/display time ruler in frames/i)).toBeTruthy();
    expect(screen.queryByText(/show all handles/i)).toBeNull();
  });

  it('renders the dopesheet ruler in seconds when seconds mode is enabled', () => {
    renderEditor({
      visualizationMode: 'dopesheet',
      totalFrames: 60,
      fps: 30,
    });

    fireEvent.pointerDown(screen.getByRole('button', { name: /sheet view options/i }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByText(/display time ruler in seconds/i));

    expect(screen.getByTestId('dopesheet-ruler')).toHaveTextContent('1.00s');
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

  it('selects and drags group header keyframes together in the sheet timeline', async () => {
    const onSelectionChange = vi.fn();
    const onKeyframeMove = vi.fn();

    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
        y: [{ id: 'ky-1', frame: 8, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
      totalFrames: 100,
      onSelectionChange,
      onKeyframeMove,
    });

    const groupKeyframe = screen.getByTestId('group-keyframe-transform-8');

    fireEvent.pointerDown(groupKeyframe, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 140 });

    await waitFor(() => {
      expect(screen.getByTestId('group-keyframe-transform-18')).toBeTruthy();
    });

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 140 });

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['kx-1', 'ky-1']));
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kx-1' },
      18,
      100
    );
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'y', keyframeId: 'ky-1' },
      18,
      200
    );
  });

  it('keeps the original header marker visible when dragging a child row keyframe away', async () => {
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
        y: [{ id: 'ky-1', frame: 8, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
      totalFrames: 100,
      onKeyframeMove: vi.fn(),
    });

    const rowKeyframe = screen.getByTestId('row-keyframe-x-kx-1');

    fireEvent.pointerDown(rowKeyframe, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 140 });

    await waitFor(() => {
      expect(screen.getByTestId('group-keyframe-transform-8')).toBeTruthy();
      expect(screen.getAllByTestId(/group-keyframe-transform-/)).toHaveLength(2);
    });
  });

  it('allows multiple master diamonds to move as one selection', () => {
    const onKeyframeMove = vi.fn();

    function ControlledSelectionEditor() {
      const [selection, setSelection] = useState<Set<string>>(new Set());

      return (
        <DopesheetEditor
          itemId="item-1"
          keyframesByProperty={{
            x: [
              { id: 'kx-1', frame: 8, value: 100, easing: 'linear' },
              { id: 'kx-2', frame: 16, value: 140, easing: 'linear' },
            ],
            y: [
              { id: 'ky-1', frame: 8, value: 200, easing: 'linear' },
              { id: 'ky-2', frame: 16, value: 240, easing: 'linear' },
            ],
          }}
          propertyValues={{ x: 100, y: 200 }}
          currentFrame={12}
          totalFrames={100}
          width={640}
          height={240}
          selectedKeyframeIds={selection}
          onSelectionChange={setSelection}
          onKeyframeMove={onKeyframeMove}
        />
      );
    }

    render(<ControlledSelectionEditor />);

    fireEvent.pointerDown(screen.getByTestId('group-keyframe-transform-8'), {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100 });

    fireEvent.pointerDown(screen.getByTestId('group-keyframe-transform-16'), {
      button: 0,
      pointerId: 2,
      clientX: 140,
      ctrlKey: true,
    });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 140 });

    fireEvent.pointerDown(screen.getByTestId('group-keyframe-transform-8'), {
      button: 0,
      pointerId: 3,
      clientX: 100,
    });
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 140 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 140 });

    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kx-1' },
      18,
      100
    );
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'y', keyframeId: 'ky-1' },
      18,
      200
    );
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kx-2' },
      26,
      140
    );
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'y', keyframeId: 'ky-2' },
      26,
      240
    );
  });

  it('duplicates selected row keyframes with alt-drag instead of moving them', () => {
    const onDuplicateKeyframes = vi.fn();
    const onKeyframeMove = vi.fn();

    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
      },
      propertyValues: { x: 100 },
      totalFrames: 100,
      onKeyframeMove,
      onDuplicateKeyframes,
    });

    fireEvent.pointerDown(screen.getByTestId('row-keyframe-x-kx-1'), {
      button: 0,
      pointerId: 1,
      clientX: 100,
      altKey: true,
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 140, altKey: true });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 140, altKey: true });

    expect(onKeyframeMove).not.toHaveBeenCalled();
    expect(onDuplicateKeyframes).toHaveBeenCalledWith([
      {
        ref: { itemId: 'item-1', property: 'x', keyframeId: 'kx-1' },
        frame: 18,
        value: 100,
      },
    ]);
  });
});
