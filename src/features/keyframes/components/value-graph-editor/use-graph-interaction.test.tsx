import { useMemo, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { useGraphInteraction } from './use-graph-interaction'
import { DEFAULT_GRAPH_PADDING, type GraphKeyframePoint, type GraphViewport } from './types'
import type { KeyframeRef } from '@/types/keyframe'

const viewport: GraphViewport = {
  width: 600,
  height: 300,
  startFrame: 0,
  endFrame: 60,
  minValue: 0,
  maxValue: 100,
}

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
]

function TestGraph() {
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const points = useMemo(
    () =>
      basePoints.map((point) => ({
        ...point,
        isSelected: selection.has(point.keyframe.id),
      })),
    [selection],
  )

  const { handleBackgroundPointerDown, handleBackgroundClick, marqueeRect } = useGraphInteraction({
    viewport,
    padding: DEFAULT_GRAPH_PADDING,
    points,
    selectedKeyframeIds: selection,
    onSelectionChange: setSelection,
  })

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
  )
}

function DragGraph({
  initialSelection = new Set<string>(['kf-1', 'kf-2']),
  onKeyframeMove = vi.fn(),
  onDuplicateKeyframes,
}: {
  initialSelection?: Set<string>
  onKeyframeMove?: (ref: KeyframeRef, frame: number, value: number) => void
  onDuplicateKeyframes?: (
    entries: Array<{ ref: KeyframeRef; frame: number; value: number }>,
  ) => void
}) {
  const [selection, setSelection] = useState<Set<string>>(new Set(initialSelection))
  const points = useMemo(
    () =>
      basePoints.map((point) => ({
        ...point,
        isSelected: selection.has(point.keyframe.id),
      })),
    [selection],
  )

  const { handleKeyframePointerDown, handlePointerMove, handlePointerUp, previewValues } =
    useGraphInteraction({
      viewport,
      padding: DEFAULT_GRAPH_PADDING,
      points,
      selectedKeyframeIds: selection,
      onSelectionChange: setSelection,
      onKeyframeMove,
      onDuplicateKeyframes,
    })

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
      <text data-testid="preview-values">{previewValues ? JSON.stringify(previewValues) : ''}</text>
    </svg>
  )
}

function DragSensitivityGraph() {
  const [selection, setSelection] = useState<Set<string>>(new Set(['kf-1']))
  const sensitivityViewport: GraphViewport = {
    width: 600,
    height: 300,
    startFrame: 0,
    endFrame: 60,
    minValue: 100,
    maxValue: 110,
  }

  const points = useMemo(
    () => [
      {
        keyframe: {
          id: 'kf-1',
          frame: 10,
          value: 105,
          easing: 'linear' as const,
        },
        itemId: 'item-1',
        property: 'x' as const,
        x: 120,
        y: 120,
        isSelected: selection.has('kf-1'),
        isDragging: false,
      },
    ],
    [selection],
  )

  const { handleKeyframePointerDown, handlePointerMove, handlePointerUp, previewValues } =
    useGraphInteraction({
      viewport: sensitivityViewport,
      padding: DEFAULT_GRAPH_PADDING,
      points,
      selectedKeyframeIds: selection,
      onSelectionChange: setSelection,
    })

  return (
    <svg
      data-testid="sensitivity-graph"
      width={sensitivityViewport.width}
      height={sensitivityViewport.height}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <circle
        data-testid="sensitivity-point"
        cx={points[0]!.x}
        cy={points[0]!.y}
        r={10}
        onPointerDown={(event) => handleKeyframePointerDown(points[0]!, event)}
      />
      <text data-testid="sensitivity-preview-values">
        {previewValues ? JSON.stringify(previewValues) : ''}
      </text>
    </svg>
  )
}

function ZoomGraph() {
  const [liveViewport, setLiveViewport] = useState<GraphViewport>({
    ...viewport,
    startFrame: 0,
    endFrame: 100,
  })

  const { zoomIn } = useGraphInteraction({
    viewport: liveViewport,
    padding: DEFAULT_GRAPH_PADDING,
    points: basePoints,
    selectedKeyframeIds: new Set(),
    onViewportChange: setLiveViewport,
    maxFrame: 100,
    minValue: 0,
    maxValue: 100,
  })

  return (
    <div>
      <button type="button" onClick={zoomIn}>
        zoom
      </button>
      <output data-testid="zoom-viewport">
        {`${liveViewport.startFrame},${liveViewport.endFrame}`}
      </output>
    </div>
  )
}

function WheelZoomGraph() {
  const [liveViewport, setLiveViewport] = useState<GraphViewport>({
    ...viewport,
    startFrame: 0,
    endFrame: 100,
    minValue: 0,
    maxValue: 100,
  })

  const { handleWheel } = useGraphInteraction({
    viewport: liveViewport,
    padding: DEFAULT_GRAPH_PADDING,
    points: basePoints,
    selectedKeyframeIds: new Set(),
    onViewportChange: setLiveViewport,
    maxFrame: 100,
    minValue: 0,
    maxValue: 100,
  })

  return (
    <div>
      <svg
        data-testid="wheel-graph"
        width={viewport.width}
        height={viewport.height}
        onWheel={handleWheel}
      />
      <output data-testid="wheel-viewport">
        {`${liveViewport.startFrame},${liveViewport.endFrame},${liveViewport.minValue},${liveViewport.maxValue}`}
      </output>
    </div>
  )
}

function WheelPanGraph() {
  const [liveViewport, setLiveViewport] = useState<GraphViewport>({
    ...viewport,
    startFrame: 10,
    endFrame: 70,
    minValue: 0,
    maxValue: 100,
  })

  const { handleWheel } = useGraphInteraction({
    viewport: liveViewport,
    padding: DEFAULT_GRAPH_PADDING,
    points: basePoints,
    selectedKeyframeIds: new Set(),
    onViewportChange: setLiveViewport,
    maxFrame: 100,
    minValue: 0,
    maxValue: 100,
  })

  return (
    <div>
      <svg
        data-testid="pan-wheel-graph"
        width={viewport.width}
        height={viewport.height}
        onWheel={handleWheel}
      />
      <output data-testid="pan-wheel-viewport">
        {`${liveViewport.startFrame},${liveViewport.endFrame},${liveViewport.minValue},${liveViewport.maxValue}`}
      </output>
    </div>
  )
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
  })

  Object.defineProperty(svg, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })

  Object.defineProperty(svg, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
}

describe('useGraphInteraction marquee selection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a marquee overlay and updates selection while dragging on the graph background', () => {
    render(<TestGraph />)

    const svg = screen.getByTestId('graph') as unknown as SVGSVGElement
    installSvgDomMocks(svg)

    fireEvent.pointerDown(screen.getByTestId('background'), {
      button: 0,
      clientX: 90,
      clientY: 90,
      pointerId: 1,
    })

    fireEvent.pointerMove(window, {
      clientX: 280,
      clientY: 210,
      pointerId: 1,
    })

    expect(screen.getByTestId('marquee')).toBeInTheDocument()
    expect(screen.getByTestId('selection')).toHaveTextContent('kf-1,kf-2')

    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument()
  })

  it('previews selected graph points as a group and commits on pointer up', () => {
    const onKeyframeMove = vi.fn()
    render(<DragGraph onKeyframeMove={onKeyframeMove} />)

    const svg = screen.getByTestId('drag-graph') as unknown as SVGSVGElement
    installSvgDomMocks(svg)

    fireEvent.pointerDown(screen.getByTestId('point-kf-1'), {
      button: 0,
      clientX: 120,
      clientY: 120,
      pointerId: 2,
    })

    fireEvent.pointerMove(svg, {
      clientX: 180,
      clientY: 90,
      pointerId: 2,
    })

    expect(onKeyframeMove).not.toHaveBeenCalled()
    expect(screen.getByTestId('preview-values')).toHaveTextContent('"kf-1"')
    expect(screen.getByTestId('preview-values')).toHaveTextContent('"kf-2"')

    fireEvent.pointerUp(svg, { pointerId: 2 })

    const movedIds = new Set(
      onKeyframeMove.mock.calls.map(([ref]) => (ref as KeyframeRef).keyframeId),
    )

    expect(movedIds).toEqual(new Set(['kf-1', 'kf-2']))
  })

  it('uses the visible y-range for drag sensitivity', () => {
    render(<DragSensitivityGraph />)

    const svg = screen.getByTestId('sensitivity-graph') as unknown as SVGSVGElement
    installSvgDomMocks(svg)

    fireEvent.pointerDown(screen.getByTestId('sensitivity-point'), {
      button: 0,
      clientX: 120,
      clientY: 120,
      pointerId: 7,
    })

    fireEvent.pointerMove(svg, {
      clientX: 120,
      clientY: 96,
      pointerId: 7,
    })

    expect(screen.getByTestId('sensitivity-preview-values')).toHaveTextContent('106')
  })

  it('duplicates dragged graph keyframes when alt is held', () => {
    const onDuplicateKeyframes = vi.fn()
    const onKeyframeMove = vi.fn()

    render(
      <DragGraph
        initialSelection={new Set(['kf-1'])}
        onKeyframeMove={onKeyframeMove}
        onDuplicateKeyframes={onDuplicateKeyframes}
      />,
    )

    const svg = screen.getByTestId('drag-graph') as unknown as SVGSVGElement
    installSvgDomMocks(svg)

    fireEvent.pointerDown(screen.getByTestId('point-kf-1'), {
      button: 0,
      clientX: 120,
      clientY: 150,
      pointerId: 9,
      altKey: true,
    })
    fireEvent.pointerMove(svg, {
      clientX: 180,
      clientY: 150,
      pointerId: 9,
      altKey: true,
    })
    fireEvent.pointerUp(svg, {
      clientX: 180,
      clientY: 150,
      pointerId: 9,
      altKey: true,
    })

    expect(onKeyframeMove).not.toHaveBeenCalled()
    expect(onDuplicateKeyframes).toHaveBeenCalled()
  })

  it('keeps the keyframe cluster in view when zooming with graph controls', () => {
    render(<ZoomGraph />)

    const zoomButton = screen.getByRole('button', { name: 'zoom' })
    fireEvent.click(zoomButton)
    fireEvent.click(zoomButton)
    fireEvent.click(zoomButton)

    const [startFrame, endFrame] = screen
      .getByTestId('zoom-viewport')
      .textContent!.split(',')
      .map(Number)
    expect(startFrame).toBe(0)
    expect(endFrame).toBeCloseTo(51.2, 4)
  })

  it('uses ctrl+wheel to zoom the frame axis without changing value bounds', () => {
    render(<WheelZoomGraph />)

    const svg = screen.getByTestId('wheel-graph') as unknown as SVGSVGElement
    installSvgDomMocks(svg)

    fireEvent.wheel(svg, {
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 150,
    })

    const [startFrame = 0, endFrame = 0, minValue = 0, maxValue = 0] = screen
      .getByTestId('wheel-viewport')
      .textContent!.split(',')
      .map(Number)

    expect(endFrame - startFrame).toBeCloseTo(80, 4)
    expect(minValue).toBe(0)
    expect(maxValue).toBe(100)
  })

  it('uses regular wheel to pan the frame viewport', () => {
    render(<WheelPanGraph />)

    const svg = screen.getByTestId('pan-wheel-graph') as unknown as SVGSVGElement
    installSvgDomMocks(svg)

    fireEvent.wheel(svg, {
      deltaY: 120,
      clientX: 300,
      clientY: 150,
    })

    const [startFrame = 0, endFrame = 0, minValue = 0, maxValue = 0] = screen
      .getByTestId('pan-wheel-viewport')
      .textContent!.split(',')
      .map(Number)

    expect(startFrame).toBeGreaterThan(10)
    expect(endFrame - startFrame).toBeCloseTo(60, 4)
    expect(minValue).toBe(0)
    expect(maxValue).toBe(100)
  })
})
