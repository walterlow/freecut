import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrimHandles } from './trim-handles';
import { VideoFadeHandles } from './video-fade-handles';
import { AudioFadeHandles } from './audio-fade-handles';
import { AudioVolumeControl } from './audio-volume-control';

describe('TrimHandles', () => {
  const defaultProps = {
    trackLocked: false,
    isAnyDragActive: false,
    isTrimming: false,
    trimHandle: null as 'start' | 'end' | null,
    activeTool: 'trim-edit',
    hoveredEdge: null as 'start' | 'end' | null,
    smartTrimIntent: null as import('../../utils/smart-trim-zones').SmartTrimIntent,
    rollHoverEdge: null as 'start' | 'end' | null,
    activeEdges: null as import('./trim-handles').ActiveEdgeState | null,
    startCursorClass: 'cursor-trim-left',
    endCursorClass: 'cursor-trim-right',
    startTone: 'default' as const,
    endTone: 'default' as const,
    hasJoinableLeft: false,
    hasJoinableRight: false,
    onTrimStart: vi.fn(),
    onJoinLeft: vi.fn(),
    onJoinRight: vi.fn(),
  };

  it('fires onTrimStart on mousedown when the left handle is visible', () => {
    const onTrimStart = vi.fn();
    render(
      <TrimHandles {...defaultProps} hoveredEdge="start" onTrimStart={onTrimStart} />
    );

    const handles = document.querySelectorAll('[class*="absolute"][class*="left-0"]');
    const leftHandle = Array.from(handles).find(
      (el) => !el.classList.contains('pointer-events-none')
    );
    expect(leftHandle).toBeTruthy();
    fireEvent.mouseDown(leftHandle!);
    expect(onTrimStart).toHaveBeenCalledWith(expect.any(Object), 'start');
  });

  it('fires onTrimStart on mousedown when the right handle is visible', () => {
    const onTrimStart = vi.fn();
    render(
      <TrimHandles {...defaultProps} hoveredEdge="end" onTrimStart={onTrimStart} />
    );

    const handles = document.querySelectorAll('[class*="absolute"][class*="right-0"]');
    const rightHandle = Array.from(handles).find(
      (el) => !el.classList.contains('pointer-events-none')
    );
    expect(rightHandle).toBeTruthy();
    fireEvent.mouseDown(rightHandle!);
    expect(onTrimStart).toHaveBeenCalledWith(expect.any(Object), 'end');
  });
});

/**
 * Regression test: overlay wrappers (video fade, audio fade, audio volume)
 * must never block trim handle mouse events.
 *
 * The bug: wrapper divs with z-30 and no pointer-events-none sat on top of the
 * TrimHandles (no z-index), intercepting mousedown events even when the inner
 * component returned null for non-select tools. This broke both the trim-edit
 * and select tool edge interactions.
 *
 * The invariant: every overlay container that sits above TrimHandles must use
 * pointer-events-none on its root, with pointer-events-auto only on interactive
 * children (buttons, drag handles).
 */
describe('overlay containers must not block trim handle events', () => {
  it('VideoFadeHandles root is pointer-events-none (non-select tool renders null but wrapper may persist)', () => {
    // When activeTool is 'select', the component renders — verify root is pointer-events-none
    const { container } = render(
      <VideoFadeHandles
        trackLocked={false}
        activeTool="select"
        lineYPercent={50}
        fadeInPercent={10}
        fadeOutPercent={10}
        isSelected={true}
        isEditing={false}
        onFadeHandleMouseDown={vi.fn()}
        onFadeHandleDoubleClick={vi.fn()}
      />
    );

    const root = container.firstElementChild!;
    expect(root.className).toContain('pointer-events-none');
    // Interactive buttons must opt back in
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn.className).toContain('pointer-events-auto');
    }
  });

  it('VideoFadeHandles returns null for non-select tools so its parent wrapper alone remains', () => {
    const { container } = render(
      <VideoFadeHandles
        trackLocked={false}
        activeTool="trim-edit"
        lineYPercent={50}
        fadeInPercent={10}
        fadeOutPercent={10}
        isSelected={true}
        isEditing={false}
        onFadeHandleMouseDown={vi.fn()}
        onFadeHandleDoubleClick={vi.fn()}
      />
    );

    // Component returns null — no children
    expect(container.firstElementChild).toBeNull();
  });

  it('AudioFadeHandles root is pointer-events-none', () => {
    const { container } = render(
      <AudioFadeHandles
        trackLocked={false}
        activeTool="select"
        lineYPercent={50}
        fadeInPercent={10}
        fadeOutPercent={10}
        isSelected={true}
        isEditing={false}
        curveEditingHandle={null}
        onFadeHandleMouseDown={vi.fn()}
        onFadeHandleDoubleClick={vi.fn()}
        onFadeCurveDotMouseDown={vi.fn()}
        onFadeCurveDotDoubleClick={vi.fn()}
      />
    );

    const root = container.firstElementChild!;
    expect(root.className).toContain('pointer-events-none');
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn.className).toContain('pointer-events-auto');
    }
  });

  it('AudioVolumeControl root is pointer-events-none', () => {
    const { container } = render(
      <AudioVolumeControl
        trackLocked={false}
        activeTool="select"
        lineYPercent={50}
        isEditing={false}
        editLabel={null}
        onVolumeMouseDown={vi.fn()}
        onVolumeDoubleClick={vi.fn()}
      />
    );

    const root = container.firstElementChild!;
    expect(root.className).toContain('pointer-events-none');
    // The drag target opts back in
    const button = screen.getByRole('button', { name: 'Adjust clip volume' });
    expect(button.className).toContain('pointer-events-auto');
  });

  it('trim handle mousedown reaches handler even with sibling overlay wrapper', () => {
    const onTrimStart = vi.fn();

    // Simulate the DOM structure from the timeline item:
    // parent clip div → [overlay wrapper (z-30, pointer-events-none)] + [TrimHandles]
    render(
      <div style={{ position: 'relative', width: 200, height: 60 }}>
        {/* Simulated video fade overlay wrapper — must be pointer-events-none */}
        <div
          data-testid="overlay-wrapper"
          className="absolute inset-x-0 bottom-0 z-30 pointer-events-none"
          style={{ top: '18px' }}
        />

        <TrimHandles
          trackLocked={false}
          isAnyDragActive={false}
          isTrimming={false}
          trimHandle={null}
          activeTool="trim-edit"
          hoveredEdge="start"
          smartTrimIntent={null}
          rollHoverEdge={null}
          activeEdges={null}
          startCursorClass="cursor-trim-left"
          endCursorClass="cursor-trim-right"
          startTone="default"
          endTone="default"
          hasJoinableLeft={false}
          hasJoinableRight={false}
          onTrimStart={onTrimStart}
          onJoinLeft={vi.fn()}
          onJoinRight={vi.fn()}
        />
      </div>
    );

    // The overlay wrapper must not intercept the event
    const overlayWrapper = screen.getByTestId('overlay-wrapper');
    expect(overlayWrapper.className).toContain('pointer-events-none');

    // Find the visible trim handle and fire mouseDown
    const handles = document.querySelectorAll('[class*="absolute"][class*="left-0"]');
    const leftHandle = Array.from(handles).find(
      (el) => !el.classList.contains('pointer-events-none') && !el.classList.contains('opacity-0')
    );
    expect(leftHandle).toBeTruthy();
    fireEvent.mouseDown(leftHandle!);
    expect(onTrimStart).toHaveBeenCalledWith(expect.any(Object), 'start');
  });
});
