import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { GpuEffectDefinition } from '@/infrastructure/gpu-effects'
import {
  GPU_CURVES_MAX_POINTS,
  serializeGpuCurvesChannelPoints,
  type GpuCurvesControlPoint,
} from '@/shared/utils/gpu-curves'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { GpuCurvesPanel } from './gpu-curves-panel'

const CURVE_SIZE = 230

const definition = {
  id: 'gpu-curves',
  name: 'Curves',
  category: 'color',
  shader: '',
  entryPoint: 'main',
  uniformSize: 0,
  params: {},
  packUniforms: () => null,
} as unknown as GpuEffectDefinition

function makeProps(
  params: Record<string, number | boolean | string> = {},
  overrides: Partial<ItemEffect> = {},
) {
  const gpuEffect: GpuEffect = { type: 'gpu-effect', gpuEffectType: 'gpu-curves', params }
  const effect: ItemEffect = { id: 'fx-1', effect: gpuEffect, enabled: true, ...overrides }
  return {
    effect,
    gpuEffect,
    definition,
    onParamChange: vi.fn(),
    onParamLiveChange: vi.fn(),
    onParamsBatchChange: vi.fn(),
    onParamsBatchLiveChange: vi.fn(),
    onReset: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
  }
}

function setupEditorSvg(): SVGSVGElement {
  const svg = document.querySelector('svg[data-curves-editor="true"]') as SVGSVGElement | null
  expect(svg).not.toBeNull()
  Object.defineProperty(svg!, 'getBoundingClientRect', {
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: CURVE_SIZE,
      bottom: CURVE_SIZE,
      width: CURVE_SIZE,
      height: CURVE_SIZE,
      toJSON: () => ({}),
    }),
    configurable: true,
  })
  return svg!
}

function getPoint(index: number): SVGEllipseElement {
  const ellipse = document.querySelector(
    `ellipse[data-curve-point="${index}"]`,
  ) as SVGEllipseElement | null
  expect(ellipse).not.toBeNull()
  return ellipse!
}

function parsePoints(serialized: unknown): GpuCurvesControlPoint[] {
  expect(typeof serialized).toBe('string')
  const raw = JSON.parse(serialized as string) as Array<[number, number]>
  return raw.map(([x, y]) => ({ x, y }))
}

const FOUR_POINT_CURVE: GpuCurvesControlPoint[] = [
  { x: 0, y: 0 },
  { x: 0.3, y: 0.4 },
  { x: 0.7, y: 0.6 },
  { x: 1, y: 1 },
]

function renderFourPointCurve() {
  const props = makeProps({ masterPoints: serializeGpuCurvesChannelPoints(FOUR_POINT_CURVE) })
  render(<GpuCurvesPanel {...props} />)
  return props
}

describe('GpuCurvesPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders one draggable handle per stored control point', () => {
    const points: GpuCurvesControlPoint[] = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.3 },
      { x: 0.5, y: 0.5 },
      { x: 0.8, y: 0.7 },
      { x: 1, y: 1 },
    ]
    render(
      <GpuCurvesPanel {...makeProps({ masterPoints: serializeGpuCurvesChannelPoints(points) })} />,
    )

    expect(document.querySelectorAll('ellipse[data-curve-point]')).toHaveLength(5)
  })

  it('drags an interior point with live updates and commits on mouseup', () => {
    const props = makeProps()
    render(<GpuCurvesPanel {...props} />)
    setupEditorSvg()

    // Default channel control yields 4 points; index 1 is the legacy shadow point.
    fireEvent.mouseDown(getPoint(1), { button: 0, clientX: 57.5, clientY: 172.5 })
    fireEvent.mouseMove(window, { clientX: 0.3 * CURVE_SIZE, clientY: 0.4 * CURVE_SIZE })

    expect(props.onParamsBatchLiveChange).toHaveBeenCalled()
    const liveUpdate = props.onParamsBatchLiveChange.mock.calls.at(-1)?.[1]
    const livePoints = parsePoints(liveUpdate.masterPoints)
    expect(livePoints).toHaveLength(4)
    expect(livePoints[1]!.x).toBeCloseTo(0.3, 2)
    expect(livePoints[1]!.y).toBeCloseTo(0.6, 2)

    fireEvent.mouseUp(window, { clientX: 0.3 * CURVE_SIZE, clientY: 0.4 * CURVE_SIZE })

    expect(props.onParamsBatchChange).toHaveBeenCalledTimes(1)
    const committed = parsePoints(props.onParamsBatchChange.mock.calls[0]?.[1].masterPoints)
    expect(committed).toHaveLength(4)
    expect(committed[1]!.x).toBeCloseTo(0.3, 2)
    expect(committed[1]!.y).toBeCloseTo(0.6, 2)
  })

  it('locks endpoint x while allowing vertical drags', () => {
    const props = makeProps()
    render(<GpuCurvesPanel {...props} />)
    setupEditorSvg()

    fireEvent.mouseDown(getPoint(0), { button: 0, clientX: 0, clientY: CURVE_SIZE })
    fireEvent.mouseMove(window, { clientX: 0.5 * CURVE_SIZE, clientY: 0.8 * CURVE_SIZE })
    fireEvent.mouseUp(window, { clientX: 0.5 * CURVE_SIZE, clientY: 0.8 * CURVE_SIZE })

    const committed = parsePoints(props.onParamsBatchChange.mock.calls[0]?.[1].masterPoints)
    expect(committed[0]!.x).toBe(0)
    expect(committed[0]!.y).toBeCloseTo(0.2, 2)
  })

  it('keeps interior points ordered by clamping x between neighbors', () => {
    const props = makeProps()
    render(<GpuCurvesPanel {...props} />)
    setupEditorSvg()

    // Drag the shadow point (x=0.25) far past the highlight point (x=0.75).
    fireEvent.mouseDown(getPoint(1), { button: 0, clientX: 57.5, clientY: 172.5 })
    fireEvent.mouseMove(window, { clientX: 0.95 * CURVE_SIZE, clientY: 0.5 * CURVE_SIZE })
    fireEvent.mouseUp(window, { clientX: 0.95 * CURVE_SIZE, clientY: 0.5 * CURVE_SIZE })

    const committed = parsePoints(props.onParamsBatchChange.mock.calls[0]?.[1].masterPoints)
    expect(committed[1]!.x).toBeLessThan(committed[2]!.x)
  })

  it('adds a point on click in empty curve area and starts dragging it', () => {
    const props = makeProps()
    render(<GpuCurvesPanel {...props} />)
    const svg = setupEditorSvg()

    fireEvent.mouseDown(svg, { button: 0, clientX: 0.5 * CURVE_SIZE, clientY: 0.5 * CURVE_SIZE })

    const added = parsePoints(props.onParamsBatchLiveChange.mock.calls[0]?.[1].masterPoints)
    expect(added).toHaveLength(5)
    expect(added[2]!.x).toBeCloseTo(0.5, 2)
    expect(added[2]!.y).toBeCloseTo(0.5, 2)

    // The freshly added point is grabbed: a mousemove drags it, mouseup commits.
    fireEvent.mouseMove(window, { clientX: 0.5 * CURVE_SIZE, clientY: 0.2 * CURVE_SIZE })
    fireEvent.mouseUp(window, { clientX: 0.5 * CURVE_SIZE, clientY: 0.2 * CURVE_SIZE })

    expect(props.onParamsBatchChange).toHaveBeenCalledTimes(1)
    const committed = parsePoints(props.onParamsBatchChange.mock.calls[0]?.[1].masterPoints)
    expect(committed).toHaveLength(5)
    expect(committed[2]!.y).toBeCloseTo(0.8, 2)
  })

  it('does not add points beyond the maximum', () => {
    const points: GpuCurvesControlPoint[] = Array.from(
      { length: GPU_CURVES_MAX_POINTS },
      (_, i) => {
        const x = i / (GPU_CURVES_MAX_POINTS - 1)
        return { x, y: x }
      },
    )
    const props = makeProps({ masterPoints: serializeGpuCurvesChannelPoints(points) })
    render(<GpuCurvesPanel {...props} />)
    const svg = setupEditorSvg()

    fireEvent.mouseDown(svg, { button: 0, clientX: 0.51 * CURVE_SIZE, clientY: 0.3 * CURVE_SIZE })

    expect(props.onParamsBatchLiveChange).not.toHaveBeenCalled()
    expect(props.onParamsBatchChange).not.toHaveBeenCalled()
  })

  it('removes an interior point on double-click and commits immediately', () => {
    const props = renderFourPointCurve()
    setupEditorSvg()

    fireEvent.mouseDown(getPoint(1), { button: 0, detail: 2, clientX: 69, clientY: 138 })

    expect(props.onParamsBatchChange).toHaveBeenCalledTimes(1)
    const committed = parsePoints(props.onParamsBatchChange.mock.calls[0]?.[1].masterPoints)
    expect(committed).toHaveLength(3)
    expect(committed.map((point) => point.x)).toEqual([0, 0.7, 1])
  })

  it('nudges a focused point with the keyboard and commits immediately', () => {
    const props = renderFourPointCurve()

    fireEvent.keyDown(getPoint(1), { key: 'ArrowUp' })

    expect(props.onParamsBatchChange).toHaveBeenCalledTimes(1)
    const committed = parsePoints(props.onParamsBatchChange.mock.calls[0]?.[1].masterPoints)
    expect(committed[1]!.x).toBeCloseTo(0.3, 4)
    expect(committed[1]!.y).toBeCloseTo(0.41, 4)
  })

  it('removes an interior point with Delete from the keyboard', () => {
    const props = renderFourPointCurve()

    fireEvent.keyDown(getPoint(1), { key: 'Delete' })

    expect(props.onParamsBatchChange).toHaveBeenCalledTimes(1)
    const committed = parsePoints(props.onParamsBatchChange.mock.calls[0]?.[1].masterPoints)
    expect(committed.map((point) => point.x)).toEqual([0, 0.7, 1])
  })

  it('never removes endpoints on double-click', () => {
    const props = makeProps()
    render(<GpuCurvesPanel {...props} />)
    setupEditorSvg()

    fireEvent.mouseDown(getPoint(0), { button: 0, detail: 2, clientX: 0, clientY: CURVE_SIZE })

    expect(props.onParamsBatchChange).not.toHaveBeenCalled()
    expect(document.querySelectorAll('ellipse[data-curve-point]')).toHaveLength(4)
  })

  it('resets the active channel by clearing the points param and restoring legacy defaults', () => {
    const points: GpuCurvesControlPoint[] = [
      { x: 0, y: 0.1 },
      { x: 0.5, y: 0.9 },
      { x: 1, y: 1 },
    ]
    const props = makeProps({ masterPoints: serializeGpuCurvesChannelPoints(points) })
    render(<GpuCurvesPanel {...props} />)

    fireEvent.click(screen.getByText('Reset Channel'))

    expect(props.onParamsBatchChange).toHaveBeenCalledTimes(1)
    const updates = props.onParamsBatchChange.mock.calls[0]?.[1]
    expect(updates.masterPoints).toBe('')
    expect(updates.masterShadowX).toBeCloseTo(0.25, 4)
    expect(updates.masterShadowY).toBeCloseTo(0.25, 4)
    expect(updates.masterHighlightX).toBeCloseTo(0.75, 4)
    expect(updates.masterHighlightY).toBeCloseTo(0.75, 4)
  })

  it('disables the header reset button when every channel is identity', () => {
    render(<GpuCurvesPanel {...makeProps()} />)
    expect(screen.getByTitle('Reset To Defaults')).toBeDisabled()
  })

  it('enables the header reset button when a channel deviates from identity', () => {
    const points: GpuCurvesControlPoint[] = [
      { x: 0, y: 0.2 },
      { x: 1, y: 1 },
    ]
    render(
      <GpuCurvesPanel {...makeProps({ redPoints: serializeGpuCurvesChannelPoints(points) })} />,
    )
    expect(screen.getByTitle('Reset To Defaults')).not.toBeDisabled()
  })

  it('blocks all curve interactions when the effect is disabled', () => {
    const props = makeProps({}, { enabled: false })
    render(<GpuCurvesPanel {...props} />)
    const svg = setupEditorSvg()

    fireEvent.mouseDown(svg, { button: 0, clientX: 0.5 * CURVE_SIZE, clientY: 0.5 * CURVE_SIZE })
    fireEvent.mouseDown(getPoint(1), { button: 0, clientX: 57.5, clientY: 172.5 })
    fireEvent.mouseMove(window, { clientX: 0.3 * CURVE_SIZE, clientY: 0.4 * CURVE_SIZE })
    fireEvent.mouseUp(window, { clientX: 0.3 * CURVE_SIZE, clientY: 0.4 * CURVE_SIZE })

    expect(props.onParamsBatchLiveChange).not.toHaveBeenCalled()
    expect(props.onParamsBatchChange).not.toHaveBeenCalled()
  })
})
