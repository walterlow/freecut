import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test'

import { DopesheetEditor } from './index'

describe('DopesheetEditor timing strip', () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight',
  )

  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 600
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 180
      },
    })
  })

  afterAll(() => {
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
    }
  })

  it('renders the timing strip above the navigator viewport column in graph mode', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-1', frame: 20, value: 100, easing: 'linear' }],
        }}
        selectedKeyframeIds={new Set(['kf-1'])}
        visualizationMode="graph"
        totalFrames={100}
        width={640}
        height={240}
      />,
    )

    expect(screen.getByTestId('keyframe-timing-strip-viewport-column')).toContainElement(
      screen.getByTestId('keyframe-timing-strip-track'),
    )
  })

  it('does not render the timing strip in dopesheet mode', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-1', frame: 20, value: 100, easing: 'linear' }],
        }}
        selectedKeyframeIds={new Set(['kf-1'])}
        visualizationMode="dopesheet"
        totalFrames={100}
        width={640}
        height={240}
      />,
    )

    expect(screen.queryByTestId('keyframe-timing-strip-track')).toBeNull()
  })

  it('slides selected keyframes without letting them cross the next keyframe', async () => {
    const onKeyframeMove = vi.fn()
    const onDragStart = vi.fn()
    const onDragEnd = vi.fn()
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [
            { id: 'kf-1', frame: 20, value: 100, easing: 'linear' },
            { id: 'kf-2', frame: 30, value: 140, easing: 'linear' },
          ],
        }}
        selectedProperty="x"
        selectedKeyframeIds={new Set(['kf-1'])}
        visualizationMode="graph"
        totalFrames={100}
        width={640}
        height={240}
        onKeyframeMove={onKeyframeMove}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('dopesheet-graph-pane').querySelector('svg')).not.toBeNull()
    })

    const marker = screen.getByTestId('keyframe-timing-strip-marker-kf-1')

    fireEvent.pointerDown(marker, { button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 420 })

    expect(screen.queryByTestId('keyframe-timing-strip-tooltip-kf-1')).toBeNull()
    await waitFor(() => {
      expect(screen.getByTestId('graph-keyframe-tooltip-kf-1')).toHaveTextContent('29')
      expect(screen.getByTestId('graph-keyframe-tooltip-kf-1')).toHaveTextContent('100')
    })

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 420 })

    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-1' },
      29,
      100,
    )
    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('shows only the active curve markers in graph mode', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-x', frame: 20, value: 100, easing: 'linear' }],
          y: [{ id: 'kf-y', frame: 24, value: 140, easing: 'linear' }],
        }}
        selectedProperty="y"
        visualizationMode="graph"
        totalFrames={100}
        width={640}
        height={240}
      />,
    )

    expect(screen.queryByTestId('keyframe-timing-strip-marker-kf-x')).toBeNull()
    expect(screen.getByTestId('keyframe-timing-strip-marker-kf-y')).toBeInTheDocument()
  })

  it('hides timing strip dots when no curve is selected in graph mode', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-x', frame: 20, value: 100, easing: 'linear' }],
        }}
        visualizationMode="graph"
        totalFrames={100}
        width={640}
        height={240}
      />,
    )

    expect(screen.queryByTestId('keyframe-timing-strip-marker-kf-x')).toBeNull()
  })

  it('selects an unselected timing strip marker before dragging it', () => {
    const onSelectionChange = vi.fn()

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-x', frame: 20, value: 100, easing: 'linear' }],
        }}
        selectedProperty="x"
        visualizationMode="graph"
        totalFrames={100}
        width={640}
        height={240}
        onSelectionChange={onSelectionChange}
        onKeyframeMove={vi.fn()}
      />,
    )

    fireEvent.pointerDown(screen.getByTestId('keyframe-timing-strip-marker-kf-x'), {
      button: 0,
      pointerId: 1,
      clientX: 100,
    })

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['kf-x']))
  })

  it('supports marquee selection across timing strip markers', async () => {
    const onSelectionChange = vi.fn()

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [
            { id: 'kf-1', frame: 20, value: 100, easing: 'linear' },
            { id: 'kf-2', frame: 30, value: 140, easing: 'linear' },
          ],
        }}
        selectedProperty="x"
        visualizationMode="graph"
        totalFrames={100}
        width={640}
        height={240}
        onSelectionChange={onSelectionChange}
      />,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    const track = screen.getByTestId('keyframe-timing-strip-track')

    fireEvent.pointerDown(track, { button: 0, pointerId: 1, clientX: 0 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 600 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 600 })

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['kf-1', 'kf-2']))
  })

  it('clears selected timing strip points when clicking empty bar space', () => {
    const onSelectionChange = vi.fn()

    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{
          x: [{ id: 'kf-1', frame: 20, value: 100, easing: 'linear' }],
        }}
        selectedProperty="x"
        selectedKeyframeIds={new Set(['kf-1'])}
        visualizationMode="graph"
        totalFrames={100}
        width={640}
        height={240}
        onSelectionChange={onSelectionChange}
      />,
    )

    const track = screen.getByTestId('keyframe-timing-strip-track')

    fireEvent.pointerDown(track, { button: 0, pointerId: 1, clientX: 0 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 0 })

    expect(onSelectionChange).toHaveBeenCalledWith(new Set())
  })
})
