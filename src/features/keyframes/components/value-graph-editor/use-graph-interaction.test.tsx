import { useMemo, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGraphInteraction } from './use-graph-interaction';
import { DEFAULT_GRAPH_PADDING, type GraphKeyframePoint, type GraphViewport } from './types';
import type { KeyframeRef } from '@/types/keyframe';

const viewport: GraphViewport = {
  width: 600,
  height: 300,
  startFrame: 0,
  endFrame: 60,
  minValue: 0,
  maxValue: 100,
};

const basePoints: GraphKeyframePoint[] = [
  {
    keyframe: {
      id: 'kf-1',
      frame: 10,
      value: 30,
      easing: 'linear',
    },
    itemId: 'item-1',
    property: 'opacity',
    x: 120,
    y: 120,
    isSelected: false,
    isDragging: false,
  },
  {
    keyframe: {
      id: 'kf-2',
      frame: 20,
      value: 50,
      easing: 'linear',
    },
    itemId: 'item-1',
    property: 'opacity',
    x: 260,
    y: 180,
    isSelected: false,
    isDragging: false,
  },
];

function TestGraph() {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const points = useMemo(
    () =>
      basePoints.map((point) => ({
        ...point,
        isSelected: selection.has(point.keyframe.id),
      })),
    [selection]
  );

  const {
    handleBackgroundPointerDown,
    handleBackgroundClick,
    marqueeRect,
  } = useGraphInteraction({
    viewport,
    padding: DEFAULT_GRAPH_PADDING,
    points,
    selectedKeyframeIds: selection,
    onSelectionChange: setSelection,
  });

  return (
    <div>
      <svg data-testid="graph" width={viewport.width} height={viewport.height}>
        <rect
          data-testid="background"
          x={DEFAULT_GRAPH_PADDING.left}
          y={DEFAULT_GRAPH_PADDING.top}
          width={viewport.width - DEFAULT_GRAPH_PADDING.left - DEFAULT_GRAPH_PADDING.right}
          height={viewport.height - DEFAULT_GRAPH_PADDING.top - DEFAULT_GRAPH_PADDING.bottom}
          fill="transparent"
          onPointerDown={handleBackgroundPointerDown}
          onClick={handleBackgroundClick}
        />
        {marqueeRect && (
          <rect
            data-testid="marquee"
            x={marqueeRect.x}
            y={marqueeRect.y}
            width={marqueeRect.width}
            height={marqueeRect.height}
          />
        )}
      </svg>
      <output data-testid="selection">{[...selection].join(',')}</output>
    </div>
  );
}

function DragGraph({
  initialSelection = new Set<string>(['kf-1', 'kf-2']),
  onKeyframeMove = vi.fn(),
}: {
  initialSelection?: Set<string>;
  onKeyframeMove?: (ref: KeyframeRef, frame: number, value: number) => void;
}) {
  const [selection, setSelection] = useState<Set<string>>(new Set(initialSelection));
  const points = useMemo(
    () =>
      basePoints.map((point) => ({
        ...point,
        isSelected: selection.has(point.keyframe.id),
      })),
    [selection]
  );

  const {
    handleKeyframePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useGraphInteraction({
    viewport,
    padding: DEFAULT_GRAPH_PADDING,
    points,
    selectedKeyframeIds: selection,
    onSelectionChange: setSelection,
    onKeyframeMove,
  });

  return (
    <svg
      data-testid="drag-graph"
      width={viewport.width}
      height={viewport.height}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {points.map((point) => (
        <circle
          key={point.keyframe.id}
          data-testid={`point-${point.keyframe.id}`}
          cx={point.x}
          cy={point.y}
          r={10}
          onPointerDown={(event) => handleKeyframePointerDown(point, event)}
        />
      ))}
    </svg>
  );
}

function installSvgDomMocks(svg: SVGSVGElement) {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: viewport.width,
      bottom: viewport.height,
      width: viewport.width,
      height: viewport.height,
      toJSON: () => ({}),
    }),
  });

  Object.defineProperty(svg, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });

  Object.defineProperty(svg, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
}

describe('useGraphInteraction marquee selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a marquee overlay and updates selection while dragging on the graph background', () => {
    render(<TestGraph />);

    const svg = screen.getByTestId('graph') as SVGSVGElement;
    installSvgDomMocks(svg);

    fireEvent.pointerDown(screen.getByTestId('background'), {
      button: 0,
      clientX: 90,
      clientY: 90,
      pointerId: 1,
    });

    fireEvent.pointerMove(window, {
      clientX: 280,
      clientY: 210,
      pointerId: 1,
    });

    expect(screen.getByTestId('marquee')).toBeInTheDocument();
    expect(screen.getByTestId('selection')).toHaveTextContent('kf-1,kf-2');

    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument();
  });

  it('moves selected graph points as a group when dragging one of them', () => {
    const onKeyframeMove = vi.fn();
    render(<DragGraph onKeyframeMove={onKeyframeMove} />);

    const svg = screen.getByTestId('drag-graph') as SVGSVGElement;
    installSvgDomMocks(svg);

    fireEvent.pointerDown(screen.getByTestId('point-kf-1'), {
      button: 0,
      clientX: 120,
      clientY: 120,
      pointerId: 2,
    });

    fireEvent.pointerMove(svg, {
      clientX: 180,
      clientY: 90,
      pointerId: 2,
    });

    const movedIds = new Set(
      onKeyframeMove.mock.calls.map(([ref]) => (ref as KeyframeRef).keyframeId)
    );

    expect(movedIds).toEqual(new Set(['kf-1', 'kf-2']));

    fireEvent.pointerUp(svg, { pointerId: 2 });
  });
});
