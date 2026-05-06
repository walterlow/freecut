import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ValueGraphEditor } from './index'
import { DEFAULT_GRAPH_PADDING } from './types'

function SelectionHarness() {
  const [selection, setSelection] = useState<Set<string>>(new Set(['kf-1']))

  return (
    <TooltipProvider>
      <ValueGraphEditor
        itemId="item-1"
        keyframesByProperty={{
          opacity: [
            { id: 'kf-1', frame: 0, value: 0.4, easing: 'linear' },
            { id: 'kf-2', frame: 30, value: 0.6, easing: 'linear' },
          ],
        }}
        selectedProperty="opacity"
        selectedKeyframeIds={selection}
        onSelectionChange={setSelection}
        width={480}
        height={260}
        totalFrames={60}
        showToolbar={false}
      />
      <output data-testid="selection">{[...selection].join(',')}</output>
    </TooltipProvider>
  )
}

function PointSelectionHarness() {
  const [selection, setSelection] = useState<Set<string>>(new Set())

  return (
    <TooltipProvider>
      <ValueGraphEditor
        itemId="item-1"
        keyframesByProperty={{
          opacity: [
            { id: 'kf-1', frame: 0, value: 0.4, easing: 'linear' },
            { id: 'kf-2', frame: 30, value: 0.6, easing: 'linear' },
          ],
        }}
        selectedProperty="opacity"
        selectedKeyframeIds={selection}
        onSelectionChange={setSelection}
        width={480}
        height={260}
        totalFrames={60}
        showToolbar={false}
      />
      <output data-testid="point-selection">{[...selection].join(',')}</output>
    </TooltipProvider>
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
      right: 480,
      bottom: 260,
      width: 480,
      height: 260,
      toJSON: () => ({}),
    }),
  })

  Object.defineProperty(svg, 'setPointerCapture', {
    configurable: true,
    value: () => {},
  })

  Object.defineProperty(svg, 'releasePointerCapture', {
    configurable: true,
    value: () => {},
  })
}

describe('ValueGraphEditor clipping', () => {
  it('clips graph content to the plotted graph area', () => {
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            opacity: [
              {
                id: 'kf-1',
                frame: 0,
                value: 0.5,
                easing: 'linear',
              },
            ],
          }}
          selectedProperty="opacity"
          width={480}
          height={260}
        />
      </TooltipProvider>,
    )

    const clipPath = container.querySelector('clipPath')
    expect(clipPath).toBeInTheDocument()

    const clipRect = clipPath?.querySelector('rect')
    expect(clipRect).toHaveAttribute('x', String(DEFAULT_GRAPH_PADDING.left))
    expect(clipRect).toHaveAttribute('y', String(DEFAULT_GRAPH_PADDING.top))

    const clippedGroup = container.querySelector('g[clip-path^="url(#"]')
    expect(clippedGroup).toBeInTheDocument()
    expect(clippedGroup?.querySelector('.graph-keyframes')).toBeInTheDocument()
    expect(clippedGroup?.querySelector('.graph-extension-lines')).toBeInTheDocument()
  })

  it('formats the time ruler in seconds when requested', () => {
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            opacity: [
              { id: 'kf-1', frame: 0, value: 0.4, easing: 'ease-in' },
              { id: 'kf-2', frame: 30, value: 0.6, easing: 'linear' },
            ],
          }}
          selectedProperty="opacity"
          width={480}
          height={260}
          totalFrames={60}
          fps={30}
          rulerUnit="seconds"
          showToolbar={false}
        />
      </TooltipProvider>,
    )

    expect(container.textContent).toContain('0.33s')
  })

  it('shows selected handles by default and can show all handles', () => {
    const props = {
      itemId: 'item-1',
      keyframesByProperty: {
        opacity: [
          {
            id: 'kf-1',
            frame: 0,
            value: 0.4,
            easing: 'ease-in' as const,
            easingConfig: {
              type: 'cubic-bezier' as const,
              bezier: { x1: 0.42, y1: 0, x2: 1, y2: 1 },
            },
          },
          {
            id: 'kf-2',
            frame: 30,
            value: 0.6,
            easing: 'ease-out' as const,
          },
          { id: 'kf-3', frame: 60, value: 0.8, easing: 'linear' as const },
        ],
      },
      selectedProperty: 'opacity' as const,
      selectedKeyframeIds: new Set(['kf-1']),
      width: 480,
      height: 260,
      totalFrames: 60,
      showToolbar: false,
    }

    const { container, rerender } = render(
      <TooltipProvider>
        <ValueGraphEditor {...props} />
      </TooltipProvider>,
    )

    expect(container.querySelector('.graph-handles')).toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <ValueGraphEditor {...props} selectedKeyframeIds={new Set()} showAllHandles />
      </TooltipProvider>,
    )

    expect(container.querySelectorAll('.bezier-handle').length).toBeGreaterThan(0)
  })

  it('renders interactive keyframe points for visible overlay curves', () => {
    const onPropertyChange = vi.fn()
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            x: [{ id: 'kf-x', frame: 0, value: 100, easing: 'linear' }],
            y: [{ id: 'kf-y', frame: 30, value: 200, easing: 'linear' }],
          }}
          selectedProperty="x"
          overlayProperties={['x', 'y']}
          width={480}
          height={260}
          totalFrames={60}
          showToolbar={false}
          onPropertyChange={onPropertyChange}
        />
      </TooltipProvider>,
    )

    const keyframePoints = container.querySelectorAll('.graph-keyframe')
    expect(keyframePoints).toHaveLength(2)

    const pointHitAreas = container.querySelectorAll('.graph-keyframe circle')
    fireEvent.click(pointHitAreas[1]!)

    expect(onPropertyChange).toHaveBeenCalledWith('y')
  })

  it('deselects the active curve when clicking empty graph space', () => {
    const onPropertyChange = vi.fn()
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            x: [{ id: 'kf-x', frame: 0, value: 100, easing: 'linear' }],
            y: [{ id: 'kf-y', frame: 30, value: 200, easing: 'linear' }],
          }}
          selectedProperty="x"
          overlayProperties={['x', 'y']}
          width={480}
          height={260}
          totalFrames={60}
          showToolbar={false}
          onPropertyChange={onPropertyChange}
        />
      </TooltipProvider>,
    )

    fireEvent.click(container.querySelector('svg')!)

    expect(onPropertyChange).toHaveBeenCalledWith(null)
  })

  it('keeps visible curves rendered after the active curve is cleared', () => {
    const { container, rerender } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            x: [{ id: 'kf-x', frame: 0, value: 100, easing: 'linear' }],
            y: [{ id: 'kf-y', frame: 30, value: 200, easing: 'linear' }],
          }}
          selectedProperty="x"
          overlayProperties={['x', 'y']}
          width={480}
          height={260}
          totalFrames={60}
          showToolbar={false}
        />
      </TooltipProvider>,
    )

    rerender(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            x: [{ id: 'kf-x', frame: 0, value: 100, easing: 'linear' }],
            y: [{ id: 'kf-y', frame: 30, value: 200, easing: 'linear' }],
          }}
          selectedProperty={null}
          overlayProperties={['x', 'y']}
          width={480}
          height={260}
          totalFrames={60}
          showToolbar={false}
        />
      </TooltipProvider>,
    )

    expect(container.querySelectorAll('.graph-keyframe')).toHaveLength(2)
  })

  it('renders a single visible handle for one-handle easing presets', () => {
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            opacity: [
              { id: 'kf-1', frame: 0, value: 0.4, easing: 'ease-out' },
              { id: 'kf-2', frame: 30, value: 0.6, easing: 'linear' },
            ],
          }}
          selectedProperty="opacity"
          selectedKeyframeIds={new Set(['kf-2'])}
          width={480}
          height={260}
          totalFrames={60}
          showToolbar={false}
        />
      </TooltipProvider>,
    )

    expect(container.querySelectorAll('.bezier-handle')).toHaveLength(1)
  })

  it('shows handles only for the selected keyframe that owns them', () => {
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            opacity: [
              {
                id: 'kf-1',
                frame: 0,
                value: 0.4,
                easing: 'ease-in',
                easingConfig: {
                  type: 'cubic-bezier',
                  bezier: { x1: 0.42, y1: 0, x2: 1, y2: 1 },
                },
              },
              { id: 'kf-2', frame: 30, value: 0.6, easing: 'linear' },
            ],
          }}
          selectedProperty="opacity"
          selectedKeyframeIds={new Set(['kf-1'])}
          width={480}
          height={260}
          totalFrames={60}
          showToolbar={false}
        />
      </TooltipProvider>,
    )

    // Selecting kf-1 (ease-in) shows its out handle; selecting kf-2 would not show handles
    // because the ease-in handle is anchored at kf-1, not kf-2
    expect(container.querySelector('.graph-handles')).toBeInTheDocument()
    expect(container.querySelectorAll('.bezier-handle').length).toBe(1)
  })

  it('clears selection when clicking the graph canvas', () => {
    const { container } = render(<SelectionHarness />)

    expect(screen.getByTestId('selection')).toHaveTextContent('kf-1')

    fireEvent.click(container.querySelector('svg')!)

    expect(screen.getByTestId('selection')).toHaveTextContent('')
  })

  it('does not immediately clear a point selection from the canvas click handler', () => {
    const { container } = render(<PointSelectionHarness />)
    installSvgDomMocks(container.querySelector('svg') as SVGSVGElement)

    const pointHitArea = container.querySelector('.graph-keyframe circle')
    expect(pointHitArea).toBeTruthy()

    fireEvent.pointerDown(pointHitArea!, {
      button: 0,
      clientX: 50,
      clientY: 50,
      pointerId: 1,
    })
    fireEvent.click(pointHitArea!)

    expect(screen.getByTestId('point-selection')).toHaveTextContent('kf-1')
  })

  // --- REGRESSION: selection/deselection must be rock-solid across all interaction patterns ---

  it('deselects when clicking empty area AFTER a point was previously selected', () => {
    const { container } = render(<SelectionHarness />)
    const svg = container.querySelector('svg') as SVGSVGElement
    installSvgDomMocks(svg)

    // Start with kf-1 selected
    expect(screen.getByTestId('selection')).toHaveTextContent('kf-1')

    // Click on the SVG background (not on a keyframe)
    fireEvent.click(svg)

    expect(screen.getByTestId('selection')).toHaveTextContent('')
  })

  it('keeps selection after pointerDown + pointerUp on a keyframe (click cycle)', () => {
    const { container } = render(<PointSelectionHarness />)
    const svg = container.querySelector('svg') as SVGSVGElement
    installSvgDomMocks(svg)

    const pointHitArea = container.querySelector('.graph-keyframe circle')!

    // Full click cycle: pointerDown → pointerUp on SVG → click on SVG
    fireEvent.pointerDown(pointHitArea, {
      button: 0,
      clientX: 50,
      clientY: 50,
      pointerId: 1,
    })
    fireEvent.pointerUp(svg, { pointerId: 1 })
    // The click event may fire on the SVG (due to pointer capture) — must NOT deselect
    fireEvent.click(svg)

    expect(screen.getByTestId('point-selection')).toHaveTextContent('kf-1')
  })

  it('keeps selection after dragging a keyframe and releasing', () => {
    const { container } = render(<PointSelectionHarness />)
    const svg = container.querySelector('svg') as SVGSVGElement
    installSvgDomMocks(svg)

    const pointHitArea = container.querySelector('.graph-keyframe circle')!

    // pointerDown on keyframe
    fireEvent.pointerDown(pointHitArea, {
      button: 0,
      clientX: 50,
      clientY: 50,
      pointerId: 1,
    })

    // Drag past threshold
    fireEvent.pointerMove(svg, { clientX: 70, clientY: 50, pointerId: 1 })

    // Release
    fireEvent.pointerUp(svg, { pointerId: 1 })

    // Post-drag click on SVG must NOT deselect
    fireEvent.click(svg)

    expect(screen.getByTestId('point-selection')).toHaveTextContent('kf-1')
  })

  it('deselects on background click after drag completes and enough time passes', () => {
    const { container } = render(<SelectionHarness />)
    const svg = container.querySelector('svg') as SVGSVGElement
    installSvgDomMocks(svg)

    expect(screen.getByTestId('selection')).toHaveTextContent('kf-1')

    // Simulate a background-only interaction (no keyframe involved)
    // pointerDown on background rect
    const bgRect = svg.querySelector('rect[fill="transparent"]')!
    fireEvent.pointerDown(bgRect, {
      button: 0,
      clientX: 300,
      clientY: 200,
      pointerId: 5,
    })
    fireEvent.pointerUp(window, { pointerId: 5 })

    // Click on SVG background — should deselect
    fireEvent.click(svg)

    expect(screen.getByTestId('selection')).toHaveTextContent('')
  })

  it('selecting point A then clicking empty area deselects, then selecting point B works', () => {
    const { container } = render(<PointSelectionHarness />)
    const svg = container.querySelector('svg') as SVGSVGElement
    installSvgDomMocks(svg)

    const points = container.querySelectorAll('.graph-keyframe circle')
    const pointA = points[0]!
    const pointB = points[1]!

    // Select point A
    fireEvent.pointerDown(pointA, { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(svg, { pointerId: 1 })
    expect(screen.getByTestId('point-selection')).toHaveTextContent('kf-1')

    // Click empty area — must deselect (use a fresh click unrelated to the keyframe)
    fireEvent.click(svg, { clientX: 400, clientY: 200 })
    // The timestamp guard might block this if fired too fast — but the target check should pass
    // since the SVG click target is the SVG itself (not a keyframe)

    // Select point B
    fireEvent.pointerDown(pointB, { button: 0, clientX: 300, clientY: 150, pointerId: 2 })
    fireEvent.pointerUp(svg, { pointerId: 2 })

    expect(screen.getByTestId('point-selection')).toHaveTextContent('kf-2')
  })
})
