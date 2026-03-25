import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EDITOR_LAYOUT } from '@/shared/ui/editor-layout';
import { ToolOperationOverlay } from './tool-operation-overlay';

describe('ToolOperationOverlay', () => {
  it.each(['trim', 'ripple'] as const)('renders a full clip-height box for %s mode', (mode) => {
    render(
      <ToolOperationOverlay
        visual={{
          boxLeftPx: 10,
          boxWidthPx: 80,
          limitEdgePositionsPx: [],
          edgePositionsPx: [10, 90],
          edgeConstraintStates: [false, false],
          constrained: false,
          mode,
        }}
      />,
    );

    expect(screen.getByTestId('tool-operation-bounds-box')).toHaveStyle({
      top: '4px',
      bottom: '4px',
    });
  });

  it('renders a compact top box for slide mode', () => {
    render(
      <ToolOperationOverlay
        visual={{
          boxLeftPx: 10,
          boxWidthPx: 80,
          limitEdgePositionsPx: [],
          edgePositionsPx: [10, 90],
          edgeConstraintStates: [false, false],
          constrained: false,
          mode: 'slide',
        }}
      />,
    );

    expect(screen.getByTestId('tool-operation-bounds-box')).toHaveStyle({
      top: '0px',
      height: '32px',
    });
  });

  it('renders a full-height box for slip mode', () => {
    render(
      <ToolOperationOverlay
        visual={{
          boxLeftPx: 10,
          boxWidthPx: 80,
          limitEdgePositionsPx: [],
          edgePositionsPx: [10, 90],
          edgeConstraintStates: [false, false],
          constrained: false,
          mode: 'slip',
        }}
      />,
    );

    expect(screen.getByTestId('tool-operation-bounds-box')).toHaveStyle({
      top: `${EDITOR_LAYOUT.timelineClipLabelRowHeight}px`,
      bottom: '4px',
    });
  });

  it('switches the edge core to red when constrained', () => {
    render(
      <ToolOperationOverlay
        visual={{
          boxLeftPx: 10,
          boxWidthPx: 80,
          limitEdgePositionsPx: [],
          edgePositionsPx: [10],
          edgeConstraintStates: [true],
          constrained: true,
          mode: 'ripple',
        }}
      />,
    );

    expect(screen.getByTestId('tool-operation-edge-core').className).toContain('bg-red-500/90');
    expect(screen.getByTestId('tool-operation-edge-core').className).not.toContain('bg-emerald-300/90');
  });

  it('only marks the constrained slip edge as red', () => {
    render(
      <ToolOperationOverlay
        visual={{
          boxLeftPx: 10,
          boxWidthPx: 80,
          limitEdgePositionsPx: [],
          edgePositionsPx: [10, 90],
          edgeConstraintStates: [true, false],
          constrained: true,
          mode: 'slip',
        }}
      />,
    );

    const edgeCores = screen.getAllByTestId('tool-operation-edge-core');
    expect(edgeCores[0]).toHaveAttribute('data-edge-constrained', 'true');
    expect(edgeCores[1]).toHaveAttribute('data-edge-constrained', 'false');
  });

  it('only marks the constrained slide edge as red', () => {
    render(
      <ToolOperationOverlay
        visual={{
          boxLeftPx: 10,
          boxWidthPx: 80,
          limitEdgePositionsPx: [],
          edgePositionsPx: [10, 90],
          edgeConstraintStates: [false, true],
          constrained: true,
          mode: 'slide',
        }}
      />,
    );

    const edgeCores = screen.getAllByTestId('tool-operation-edge-core');
    expect(edgeCores[0]).toHaveAttribute('data-edge-constrained', 'false');
    expect(edgeCores[1]).toHaveAttribute('data-edge-constrained', 'true');
  });
});
