import { useState, type ComponentProps } from 'react'
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DopesheetEditor } from './index'
import { EXPRESSION_DOCK_HEIGHT } from './dopesheet-expression-dock'

// Renders the whole dopesheet repeatedly; measured ~6s under v8 coverage on a loaded
// runner against vitest's 5s default. Scoped here so a hang elsewhere still fails fast.
describe('DopesheetEditor property groups', { timeout: 15_000 }, () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  beforeEach(() => {
    localStorage.clear()
  })

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
      />,
    )
  }

  async function openExpressionEditor(propertyLabel: string): Promise<void> {
    fireEvent.click(
      screen.getByRole('button', {
        name: new RegExp(`add ${propertyLabel} expression`, 'i'),
      }),
    )
    await screen.findByRole('textbox', {
      name: new RegExp(`${propertyLabel} expression source`, 'i'),
    })
  }

  it('renders accordion-style groups and collapses their rows', () => {
    renderEditor()

    expect(screen.getByRole('button', { name: /collapse transform/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /collapse audio/i })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeTruthy()
    expect(
      screen.getByRole('spinbutton', {
        name: /volume \(db\) value at playhead/i,
      }),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /collapse transform/i }))

    expect(
      screen.queryByRole('spinbutton', {
        name: /x position value at playhead/i,
      }),
    ).toBeNull()
    expect(screen.getByRole('button', { name: /expand transform/i })).toBeTruthy()
    expect(
      screen.getByRole('spinbutton', {
        name: /volume \(db\) value at playhead/i,
      }),
    ).toBeTruthy()
  })

  it('renders the classic Edit presentation without Motion property chrome', () => {
    renderEditor({ presentation: 'classic' })

    expect(screen.getByTestId('dopesheet-ruler')).toBeTruthy()
    expect(screen.getByText('Property')).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeTruthy()
    expect(
      screen.getByRole('spinbutton', {
        name: /volume \(db\) value at playhead/i,
      }),
    ).toBeTruthy()

    expect(screen.queryByText('Parameters')).toBeNull()
    expect(screen.queryByRole('button', { name: /collapse transform/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /show .* curve/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /lock .* row/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /add .* expression/i })).toBeNull()
    expect(screen.queryByTestId('keyframe-navigator-thumb')).toBeNull()
    expect(screen.queryByRole('slider', { name: /horizontal zoom/i })).toBeNull()
  })

  it('keeps procedural text-animation bands visible without authored keyframes', () => {
    renderEditor({
      presentation: 'classic',
      keyframesByProperty: {},
      propertyValues: {},
      textMotionBands: [
        {
          slot: 'in',
          presetId: 'typewriter',
          fromFrame: 0,
          toFrame: 24,
          clipFromFrame: 0,
          clipToFrame: 100,
          unitCount: 4,
          durationFrames: 12,
          offsetFrames: 0,
        },
      ],
    })

    expect(screen.getByTestId('edit-text-motion-row-in')).toBeInTheDocument()
    expect(screen.getByTestId('edit-text-motion-band-in')).toHaveAttribute('data-to-frame', '24')
  })

  it('selects a property layer by clicking its classic Edit row', () => {
    const onActivePropertyChange = vi.fn()
    renderEditor({
      presentation: 'classic',
      onActivePropertyChange,
    })

    fireEvent.click(screen.getByText('Volume (dB)'))

    expect(onActivePropertyChange).toHaveBeenCalledWith('volume')
  })

  it('filters the classic Edit presentation between animated and all properties', () => {
    renderEditor({
      presentation: 'classic',
      keyframesByProperty: {
        x: [{ id: 'kf-x', frame: 12, value: 100, easing: 'linear' }],
        volume: [],
      },
    })

    const animated = screen.getByRole('button', { name: 'Animated' })
    const all = screen.getByRole('button', { name: 'All' })
    expect(all).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeTruthy()
    expect(
      screen.getByRole('spinbutton', { name: /volume \(db\) value at playhead/i }),
    ).toBeTruthy()

    fireEvent.click(animated)

    expect(animated).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeTruthy()
    expect(
      screen.queryByRole('spinbutton', { name: /volume \(db\) value at playhead/i }),
    ).toBeNull()

    fireEvent.click(all)

    expect(all).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('spinbutton', { name: /volume \(db\) value at playhead/i }),
    ).toBeTruthy()
  })

  it('uses middle-button drag to pan only the keyframe rows vertically', () => {
    renderEditor({ presentation: 'classic' })

    const scrollArea = screen.getByTestId('dopesheet-scroll-area')
    scrollArea.scrollTop = 40
    const middleMouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 1,
      clientY: 100,
    })

    scrollArea.dispatchEvent(middleMouseDown)
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientY: 130,
      }),
    )

    expect(middleMouseDown.defaultPrevented).toBe(true)
    expect(scrollArea.scrollTop).toBe(10)
    expect(document.body.style.cursor).toBe('grabbing')

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientY: 160,
      }),
    )

    expect(scrollArea.scrollTop).toBe(10)
    expect(document.body.style.cursor).toBe('')
  })

  it('matches the main ruler with bottom-anchored major and pooled minor ticks', () => {
    renderEditor({ presentation: 'classic', totalFrames: 120 })

    const ruler = screen.getByTestId('dopesheet-ruler')
    const majorTicks = ruler.querySelectorAll('[data-dopesheet-ruler-major-tick]')
    const minorTickLayers = ruler.querySelectorAll('[data-dopesheet-ruler-minor-ticks]')

    expect(majorTicks.length).toBeGreaterThan(1)
    expect(majorTicks[0]).toHaveClass('bottom-0', 'h-2', 'border-white/30')
    expect(minorTickLayers).toHaveLength(1)
    expect(minorTickLayers[0]).toHaveClass('bottom-0', 'h-1')
  })

  it('shows global frame labels on the shared Edit ruler', () => {
    const timelineScrollContainerRef = {
      current: document.createElement('div'),
    }
    renderEditor({
      presentation: 'classic',
      itemFrom: 100,
      frameViewport: { startFrame: -100, endFrame: 0 },
      timelineScrollContainerRef,
    })

    const ticks = Array.from(
      screen
        .getByTestId('dopesheet-ruler')
        .querySelectorAll<HTMLElement>('[data-dopesheet-ruler-major-tick]'),
    )
    const globalZeroTick = ticks.find((tick) => tick.style.left === '0px')

    expect(globalZeroTick).toHaveTextContent('0')
  })

  it('forwards guarded ctrl-wheel zoom from the shared Edit timeline', () => {
    const timeline = document.createElement('div')
    const forwardedWheel = vi.fn()
    timeline.addEventListener('wheel', forwardedWheel)

    renderEditor({
      presentation: 'classic',
      viewportInteractionEnabled: false,
      timelineScrollContainerRef: { current: timeline },
    })

    const root = screen.getByTestId('dopesheet-editor-root')
    const guardedEvent = createEvent.wheel(root, {
      ctrlKey: true,
      clientX: 420,
      deltaY: -100,
      cancelable: true,
    })

    // Match App.tsx's document-capture browser-zoom guard.
    guardedEvent.preventDefault()
    fireEvent(root, guardedEvent)

    expect(forwardedWheel).toHaveBeenCalledOnce()
    const forwardedEvent = forwardedWheel.mock.calls[0]?.[0] as WheelEvent
    expect(forwardedEvent.ctrlKey).toBe(true)
    expect(forwardedEvent.clientX).toBe(420)
    expect(forwardedEvent.deltaY).toBe(-100)
  })

  it('shows a functional axis constraint on the classic primary scale row', () => {
    const onConstraintChange = vi.fn()
    renderEditor({
      presentation: 'classic',
      keyframesByProperty: { width: [], height: [] },
      propertyValues: { width: 100, height: 100 },
      propertyLabels: { width: 'Scale X', height: 'Scale Y' },
      axisConstraintByProperty: {
        width: {
          label: 'Scale',
          constrained: true,
          onChange: onConstraintChange,
        },
      },
    })

    expect(screen.getByText('Scale X')).toBeTruthy()
    expect(screen.getByText('Scale Y')).toBeTruthy()
    const constraint = screen.getByRole('button', {
      name: 'Unconstrain Scale axes',
    })
    expect(constraint).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Scale X').nextElementSibling).toBe(constraint)

    fireEvent.click(constraint)
    expect(onConstraintChange).toHaveBeenCalledWith(false)
  })

  it('expands and collapses sibling property groups with Shift-click', () => {
    renderEditor()

    fireEvent.click(screen.getByRole('button', { name: /collapse transform/i }), {
      shiftKey: true,
    })

    expect(screen.getByRole('button', { name: /expand transform/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /expand audio/i })).toBeTruthy()
    expect(
      screen.queryByRole('spinbutton', {
        name: /x position value at playhead/i,
      }),
    ).toBeNull()
    expect(
      screen.queryByRole('spinbutton', {
        name: /volume \(db\) value at playhead/i,
      }),
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /expand transform/i }), {
      shiftKey: true,
    })

    expect(screen.getByRole('button', { name: /collapse transform/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /collapse audio/i })).toBeTruthy()
  })

  it('renders linked property controls and removes a link from its popover', () => {
    const onPropertyLinkPointerDown = vi.fn()
    const onRemovePropertyLink = vi.fn()
    renderEditor({
      keyframesByProperty: { x: [] },
      propertyValues: { x: 240 },
      propertyLinks: [
        {
          type: 'link',
          targetProperty: 'x',
          sourceItemId: 'source-1',
          sourceProperty: 'x',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
      linkedTransformSourceLabels: { x: 'Source layer → X Position' },
      onPropertyLinkPointerDown,
      onRemovePropertyLink,
      onPropertyValueCommit: vi.fn(),
    })

    const linkButton = screen.getByRole('button', {
      name: /linked to source layer → x position/i,
    })
    const valueInput = screen.getByRole('spinbutton', {
      name: /x position value at playhead/i,
    })

    expect(valueInput).toBeDisabled()
    fireEvent.pointerDown(linkButton, { button: 0, pointerId: 7 })
    expect(onPropertyLinkPointerDown).toHaveBeenCalledWith(expect.anything(), 'x')

    fireEvent.click(linkButton)
    fireEvent.click(screen.getByRole('button', { name: /remove property link/i }))
    expect(onRemovePropertyLink).toHaveBeenCalledWith('x')
  })

  it('exposes the pick whip for scalar Shape properties', () => {
    const onPropertyLinkPointerDown = vi.fn()
    renderEditor({
      keyframesByProperty: { trimPathEnd: [] },
      propertyValues: { trimPathEnd: 100 },
      onPropertyLinkPointerDown,
      onPropertyValueCommit: vi.fn(),
    })

    const linkButton = screen.getByRole('button', {
      name: /drag to link trim paths end to another property/i,
    })
    expect(linkButton.querySelector('[data-testid="pick-whip-icon"]')).toBeTruthy()
    fireEvent.pointerDown(linkButton, { button: 0, pointerId: 12 })

    expect(onPropertyLinkPointerDown).toHaveBeenCalledWith(expect.anything(), 'trimPathEnd')
  })

  it('keeps Property Link controls available in graph mode', () => {
    const onPropertyLinkPointerDown = vi.fn()
    renderEditor({
      visualizationMode: 'graph',
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      onPropertyLinkPointerDown,
    })

    const pickWhip = screen.getByRole('button', {
      name: /drag to link x position to another property/i,
    })
    fireEvent.pointerDown(pickWhip, { button: 0, pointerId: 13 })

    expect(onPropertyLinkPointerDown).toHaveBeenCalledWith(expect.anything(), 'x')
  })

  it('edits, validates, enables, and applies a sandboxed expression', async () => {
    const onSetPropertyExpression = vi.fn()
    renderEditor({
      keyframesByProperty: { x: [] },
      propertyValues: { x: 200 },
      preExpressionPropertyValues: { x: 100 },
      onSetPropertyExpression,
      onRemovePropertyExpression: vi.fn(),
    })

    await openExpressionEditor('X Position')
    const editor = screen.getByRole('textbox', {
      name: /x position expression source/i,
    }) as HTMLTextAreaElement
    expect(screen.getByText('Advanced')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'X Position expression editor' })).toBeInTheDocument()
    expect(screen.getByText('Pre-expression').parentElement).toHaveTextContent('100.00')
    expect(screen.getByText('Post-expression').parentElement).toHaveTextContent('100.00')

    fireEvent.change(screen.getByRole('combobox', { name: 'Expression presets' }), {
      target: { value: 'value + sin(time * 6.283) * 20' },
    })
    expect(editor).toHaveValue('value + sin(time * 6.283) * 20')

    fireEvent.change(editor, { target: { value: 'value / 0' } })
    expect(screen.getByText('Division by zero')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()

    fireEvent.change(editor, { target: { value: 'value * 2' } })
    expect(screen.getByText('Post-expression').parentElement).toHaveTextContent('200.00')
    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onSetPropertyExpression).toHaveBeenCalledWith('x', 'value * 2', false)
  })

  it('offers categorized presets and an in-dock syntax guide', async () => {
    renderEditor({
      keyframesByProperty: { x: [] },
      propertyValues: { x: 100 },
      onSetPropertyExpression: vi.fn(),
    })

    await openExpressionEditor('X Position')
    const editor = screen.getByRole('textbox', {
      name: /x position expression source/i,
    }) as HTMLTextAreaElement
    const presets = screen.getByRole('combobox', {
      name: 'Expression presets',
    })

    expect(presets.querySelectorAll('optgroup')).toHaveLength(3)
    expect(presets.querySelectorAll('option').length).toBeGreaterThan(8)

    fireEvent.click(screen.getByRole('button', { name: 'Open expression syntax guide' }))
    expect(screen.getByRole('region', { name: 'Expression syntax guide' })).toBeInTheDocument()
    expect(screen.getByText('Current value')).toBeInTheDocument()
    expect(screen.getByText('value', { selector: 'code' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Functions' }))
    expect(screen.getByText('Clamp')).toBeInTheDocument()
    expect(screen.getByText('clamp(x, min, max)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'References' }))
    expect(screen.getByText('prop("layer-id", "property")')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Errors' }))
    expect(screen.getByText('Wrong value type')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Recipes' }))
    fireEvent.click(screen.getByRole('button', { name: /gentle oscillation/i }))
    expect(editor).toHaveValue('value + sin(time * 6.283) * 20')

    fireEvent.click(screen.getByRole('button', { name: 'Close expression syntax guide' }))
    expect(screen.queryByRole('region', { name: 'Expression syntax guide' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Expression presets' })).toBeInTheDocument()
  })

  it('keeps a stored expression unchanged when its docked draft is cancelled', () => {
    const onSetPropertyExpression = vi.fn()
    renderEditor({
      keyframesByProperty: { x: [] },
      propertyValues: { x: 200 },
      preExpressionPropertyValues: { x: 100 },
      propertyExpressions: [
        {
          type: 'expression',
          targetProperty: 'x',
          source: 'value * 2',
          enabled: true,
        },
      ],
      onSetPropertyExpression,
      onRemovePropertyExpression: vi.fn(),
    })

    const indicator = screen.getByRole('button', {
      name: /edit x position expression/i,
    })
    fireEvent.click(indicator)
    fireEvent.change(screen.getByRole('textbox', { name: /x position expression source/i }), {
      target: { value: 'value / 0' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onSetPropertyExpression).not.toHaveBeenCalled()
    fireEvent.click(indicator)
    expect(screen.getByRole('textbox', { name: /x position expression source/i })).toHaveValue(
      'value * 2',
    )
  })

  it('reports dock height while the expression editor is open', async () => {
    const onExpressionDockHeightChange = vi.fn()
    renderEditor({
      keyframesByProperty: { x: [] },
      propertyValues: { x: 100 },
      onSetPropertyExpression: vi.fn(),
      onRemovePropertyExpression: vi.fn(),
      onExpressionDockHeightChange,
    })

    await openExpressionEditor('X Position')
    expect(onExpressionDockHeightChange).toHaveBeenLastCalledWith(EXPRESSION_DOCK_HEIGHT)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onExpressionDockHeightChange).toHaveBeenLastCalledWith(0)
  })

  it('keeps the expression button directly available and shows stored state', () => {
    renderEditor({
      keyframesByProperty: { x: [] },
      propertyValues: { x: 200 },
      preExpressionPropertyValues: { x: 100 },
      propertyExpressions: [
        {
          type: 'expression',
          targetProperty: 'x',
          source: 'value * 2',
          enabled: true,
        },
      ],
      onSetPropertyExpression: vi.fn(),
      onRemovePropertyExpression: vi.fn(),
    })

    expect(screen.queryByRole('button', { name: /add x position expression/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /edit x position expression/i }))
    expect(screen.getByRole('textbox', { name: /x position expression source/i })).toHaveValue(
      'value * 2',
    )
  })

  it('surfaces a stored expression error on its indicator', () => {
    renderEditor({
      keyframesByProperty: { x: [] },
      propertyValues: { x: 100 },
      preExpressionPropertyValues: { x: 100 },
      propertyExpressions: [
        {
          type: 'expression',
          targetProperty: 'x',
          source: 'value / 0',
          enabled: true,
        },
      ],
      onSetPropertyExpression: vi.fn(),
      onRemovePropertyExpression: vi.fn(),
    })

    const indicator = screen.getByRole('button', {
      name: /edit x position expression: division by zero/i,
    })
    expect(indicator).toHaveAttribute('title', 'X Position expression error: Division by zero')
    expect(indicator).toHaveClass('text-red-400')
  })

  it('inserts an Expression pick-whip reference at the editor cursor', async () => {
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      onSetPropertyExpression: vi.fn(),
      onRemovePropertyExpression: vi.fn(),
      resolveExpressionReference: (_itemId, property) => (property === 'y' ? 200 : 100),
    })

    await openExpressionEditor('X Position')
    const editor = screen.getByRole('textbox', {
      name: /x position expression source/i,
    }) as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'value + ' } })
    editor.setSelectionRange(8, 8)
    const yRow = screen
      .getByText('Y Position')
      .closest<HTMLElement>('[data-expression-item-id][data-expression-property]')!
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => yRow),
    })

    const referenceControl = screen.getByRole('button', {
      name: /pick a reference property for x position/i,
    })

    fireEvent.pointerDown(referenceControl, {
      button: 0,
      pointerId: 21,
      clientX: 0,
      clientY: 0,
    })
    expect(screen.getByTestId('expression-reference-pick-whip')).toBeInTheDocument()
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 30, clientY: 30 })
    fireEvent.pointerUp(window, { pointerId: 21, clientX: 30, clientY: 30 })

    expect(editor).toHaveValue('value + prop("item-1", "y")')
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('inserts a reference by clicking a highlighted property and cancels picking with Escape', async () => {
    renderEditor({
      keyframesByProperty: { x: [], y: [], width: [], height: [] },
      propertyValues: { x: 100, y: 200, width: 100, height: 100 },
      hiddenPropertyRows: ['height'],
      compoundPropertyRows: {
        width: {
          label: 'Scale',
          value: { x: 100, y: 100 },
          preExpressionValue: { x: 100, y: 100 },
          unit: '%',
          linkProperty: 'scale',
          onCommit: vi.fn(),
        },
      },
      onSetPropertyExpression: vi.fn(),
      onRemovePropertyExpression: vi.fn(),
      resolveExpressionReference: (_itemId, property) => (property === 'y' ? 200 : 100),
    })

    await openExpressionEditor('X Position')
    const editor = screen.getByRole('textbox', {
      name: /x position expression source/i,
    }) as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'value + ' } })
    editor.setSelectionRange(8, 8)

    const referenceControl = screen.getByRole('button', {
      name: /pick a reference property for x position/i,
    })
    const xRow = screen
      .getByText('X Position')
      .closest<HTMLElement>('[data-expression-item-id][data-expression-property]')!
    const yRow = screen
      .getByText('Y Position')
      .closest<HTMLElement>('[data-expression-item-id][data-expression-property]')!
    const scaleRow = screen
      .getByText('Scale', { exact: true })
      .closest<HTMLElement>('[data-expression-item-id][data-expression-property]')!

    fireEvent.click(referenceControl)
    expect(screen.getByText(/click a highlighted row/i)).toBeInTheDocument()
    expect(xRow).toHaveAttribute('data-expression-reference-unavailable', 'true')
    expect(yRow).toHaveAttribute('data-expression-reference-pickable', 'true')
    expect(scaleRow).toHaveAttribute('data-expression-reference-unavailable', 'true')

    fireEvent.click(yRow)
    expect(editor).toHaveValue('value + prop("item-1", "y")')
    expect(screen.queryByText(/click a highlighted row/i)).toBeNull()
    expect(yRow).not.toHaveAttribute('data-expression-reference-pickable')

    fireEvent.click(referenceControl)
    expect(screen.getByText(/click a highlighted row/i)).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(/click a highlighted row/i)).toBeNull()
    expect(yRow).not.toHaveAttribute('data-expression-reference-pickable')
  })

  it('replaces the untouched default value when a reference property is clicked', async () => {
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      onSetPropertyExpression: vi.fn(),
      resolveExpressionReference: (_itemId, property) => (property === 'y' ? 200 : 100),
    })

    await openExpressionEditor('X Position')
    const editor = screen.getByRole('textbox', {
      name: /x position expression source/i,
    }) as HTMLTextAreaElement
    const referenceControl = screen.getByRole('button', {
      name: /pick a reference property for x position/i,
    })
    const yRow = screen
      .getByText('Y Position')
      .closest<HTMLElement>('[data-expression-item-id][data-expression-property]')!

    expect(editor).toHaveValue('value')
    fireEvent.click(referenceControl)
    fireEvent.click(yRow)

    expect(editor).toHaveValue('prop("item-1", "y")')
  })

  it('keeps connectors when one endpoint is outside the zoomed viewport', () => {
    renderEditor({
      keyframesByProperty: {
        x: [
          { id: 'kx-offscreen', frame: 0, value: 100, easing: 'linear' },
          { id: 'kx-visible', frame: 75, value: 200, easing: 'linear' },
        ],
      },
      propertyValues: { x: 200 },
      totalFrames: 100,
      frameViewport: { startFrame: 50, endFrame: 100 },
    })

    // Category rows summarize child keyframes with diamonds only; the actual
    // property row remains the sole owner of the easing connector.
    expect(screen.getAllByTestId('keyframe-connector')).toHaveLength(1)
    const offscreenMarker = screen.getByTestId('row-keyframe-x-kx-offscreen')
    expect(Number.parseFloat(offscreenMarker.style.left)).toBeLessThan(0)
    expect(screen.getByTestId('row-keyframe-x-kx-visible')).toBeTruthy()
  })

  it('filters parameter groups from the menu', () => {
    renderEditor()

    fireEvent.pointerDown(screen.getByRole('button', { name: /parameter display options/i }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(screen.getByText(/display audio parameters/i))

    expect(
      screen.getByRole('spinbutton', {
        name: /x position value at playhead/i,
        hidden: true,
      }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('spinbutton', {
        name: /volume \(db\) value at playhead/i,
        hidden: true,
      }),
    ).toBeNull()
  })

  it('keeps category rows as summaries instead of keyframe owners', () => {
    const onAddKeyframe = vi.fn()
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      onAddKeyframe,
    })

    expect(
      screen.queryByRole('button', {
        name: /toggle transform keyframes at playhead/i,
      }),
    ).toBeNull()
    expect(
      screen.getByRole('button', {
        name: /toggle x position keyframe at playhead/i,
      }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', {
        name: /toggle y position keyframe at playhead/i,
      }),
    ).toBeEnabled()
    expect(onAddKeyframe).not.toHaveBeenCalled()
  })

  it('locks a row and disables its edit controls', () => {
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      onAddKeyframe: vi.fn(),
      onPropertyValueCommit: vi.fn(),
    })

    fireEvent.click(screen.getByRole('button', { name: /lock x position row/i }))

    expect(screen.getByRole('button', { name: /unlock x position row/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeDisabled()
    expect(
      screen.getByRole('button', {
        name: /toggle x position keyframe at playhead/i,
      }),
    ).toBeDisabled()
    expect(
      screen.getByRole('spinbutton', { name: /y position value at playhead/i }),
    ).not.toBeDisabled()
  })

  it('shift-clicking a row lock toggles every row across groups', () => {
    renderEditor({
      keyframesByProperty: { x: [], y: [], volume: [] },
      propertyValues: { x: 100, y: 200, volume: -6 },
    })

    fireEvent.click(screen.getByRole('button', { name: /lock x position row/i }), {
      shiftKey: true,
    })

    for (const label of [/unlock x position row/i, /unlock y position row/i, /unlock volume/i]) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
    }

    // Shift-clicking any locked row releases the whole sheet again.
    fireEvent.click(screen.getByRole('button', { name: /unlock volume/i }), { shiftKey: true })

    for (const label of [/lock x position row/i, /lock y position row/i, /lock volume/i]) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('shift-clicking a group lock toggles rows outside that group', () => {
    renderEditor({
      keyframesByProperty: { x: [], y: [], volume: [] },
      propertyValues: { x: 100, y: 200, volume: -6 },
    })

    fireEvent.click(screen.getByRole('button', { name: /^lock transform rows$/i }), {
      shiftKey: true,
    })

    expect(screen.getByRole('button', { name: /^unlock volume/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /^unlock audio rows$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: /^unlock transform rows$/i }), {
      shiftKey: true,
    })

    expect(screen.getByRole('button', { name: /^lock volume/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('uses the curve button to toggle graph property visibility', () => {
    const onPropertyChange = vi.fn()
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      visualizationMode: 'graph',
      onPropertyChange,
    })

    expect(screen.getByRole('button', { name: /show x position curve/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /show y position curve/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    // Turning Y on makes it the active curve
    fireEvent.click(screen.getByRole('button', { name: /show y position curve/i }))
    expect(onPropertyChange).toHaveBeenCalledWith('y')
  })

  it('can render transform properties directly while preserving other group headers', () => {
    renderEditor({
      visualizationMode: 'graph',
      inlinePropertyGroupIds: ['transform'],
    })

    expect(screen.queryByRole('button', { name: /collapse transform/i })).toBeNull()
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /collapse audio/i })).toBeTruthy()
  })

  it('consolidates vector axes into purposeful Position, Scale, and Anchor rows', () => {
    const onPositionCommit = vi.fn()
    const onScaleCommit = vi.fn()
    const onAnchorCommit = vi.fn()
    renderEditor({
      keyframesByProperty: {
        x: [],
        y: [],
        width: [],
        height: [],
        anchorX: [],
        anchorY: [],
        rotation: [],
      },
      propertyValues: {
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 60,
        rotation: 0,
      },
      hiddenPropertyRows: ['y', 'height', 'anchorY'],
      compoundPropertyRows: {
        x: {
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          onCommit: onPositionCommit,
        },
        width: {
          label: 'Scale',
          value: { x: 100, y: 100 },
          unit: '%',
          onCommit: onScaleCommit,
        },
        anchorX: {
          label: 'Anchor',
          value: { x: 50, y: 60 },
          unit: 'px',
          onCommit: onAnchorCommit,
        },
      },
    })

    expect(screen.getByLabelText('Position X')).toBeInTheDocument()
    expect(screen.getByLabelText('Position Y')).toBeInTheDocument()
    expect(screen.getByLabelText('Scale X')).toBeInTheDocument()
    expect(screen.getByLabelText('Scale Y')).toBeInTheDocument()
    expect(screen.getByLabelText('Anchor X')).toBeInTheDocument()
    expect(screen.getByLabelText('Anchor Y')).toBeInTheDocument()
    expect(screen.queryByLabelText(/y position value at playhead/i)).toBeNull()
    expect(screen.queryByLabelText(/height value at playhead/i)).toBeNull()
    expect(screen.queryByLabelText(/anchor y value at playhead/i)).toBeNull()

    fireEvent.change(screen.getByLabelText('Position Y'), {
      target: { value: '48' },
    })
    fireEvent.blur(screen.getByLabelText('Position Y'))
    expect(onPositionCommit).toHaveBeenCalledWith('y', 48, {
      allowCreate: false,
    })
  })

  it('exposes one Vector2 Property Link for a compound Position row', () => {
    const onPropertyLinkPointerDown = vi.fn()
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 10, y: 20 },
      hiddenPropertyRows: ['y'],
      compoundPropertyRows: {
        x: {
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          linkProperty: 'position',
          onCommit: vi.fn(),
        },
      },
      propertyLinks: [
        {
          type: 'link',
          targetProperty: 'position',
          sourceItemId: 'source-layer',
          sourceProperty: 'position',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
      propertyLinkSourceLabels: { position: 'Source layer -> Position' },
      onPropertyLinkPointerDown,
      onRemovePropertyLink: vi.fn(),
    })

    const linkButton = screen.getByRole('button', {
      name: /linked to source layer -> position/i,
    })
    fireEvent.pointerDown(linkButton, { button: 0, pointerId: 14 })

    expect(onPropertyLinkPointerDown).toHaveBeenCalledWith(expect.anything(), 'position')
    expect(screen.getByLabelText('Position X')).toBeDisabled()
    expect(screen.getByLabelText('Position Y')).toBeDisabled()
    expect(linkButton.closest('[data-expression-property]')).toHaveAttribute(
      'data-expression-property',
      'position',
    )
  })

  it('switches the existing main graph between value and speed semantics', () => {
    const onGraphModeChange = vi.fn()
    const { rerender } = render(
      <DopesheetEditor
        itemId="item-vector-graph"
        keyframesByProperty={{
          x: [
            { id: 'position-0', frame: 0, value: 0, easing: 'linear' },
            { id: 'position-1', frame: 30, value: 100, easing: 'linear' },
          ],
          y: [
            { id: 'position-0:y', frame: 0, value: 0, easing: 'linear' },
            { id: 'position-1:y', frame: 30, value: 50, easing: 'linear' },
          ],
        }}
        hiddenPropertyRows={['y']}
        compoundPropertyRows={{
          x: {
            label: 'Position',
            value: { x: 0, y: 0 },
            unit: 'px',
            onCommit: vi.fn(),
          },
        }}
        compoundSecondaryProperties={{ x: 'y' }}
        selectedProperty="x"
        visualizationMode="graph"
        graphMode="value"
        onGraphModeChange={onGraphModeChange}
        speedGraphContent={<div data-testid="main-speed-graph">Velocity editor</div>}
        width={640}
        height={240}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Speed' }))
    expect(onGraphModeChange).toHaveBeenCalledWith('speed')

    rerender(
      <DopesheetEditor
        itemId="item-vector-graph"
        keyframesByProperty={{
          x: [
            { id: 'position-0', frame: 0, value: 0, easing: 'linear' },
            { id: 'position-1', frame: 30, value: 100, easing: 'linear' },
          ],
          y: [
            { id: 'position-0:y', frame: 0, value: 0, easing: 'linear' },
            { id: 'position-1:y', frame: 30, value: 50, easing: 'linear' },
          ],
        }}
        hiddenPropertyRows={['y']}
        compoundPropertyRows={{
          x: {
            label: 'Position',
            value: { x: 0, y: 0 },
            unit: 'px',
            onCommit: vi.fn(),
          },
        }}
        compoundSecondaryProperties={{ x: 'y' }}
        selectedProperty="x"
        visualizationMode="graph"
        graphMode="speed"
        onGraphModeChange={onGraphModeChange}
        speedGraphContent={<div data-testid="main-speed-graph">Velocity editor</div>}
        width={640}
        height={240}
      />,
    )

    expect(screen.getByTestId('main-speed-graph')).toBeInTheDocument()
  })

  it('renders lane-only presentation without duplicating editor chrome', () => {
    renderEditor({
      presentation: 'lanes',
      propertyColumnWidth: 420,
      inlinePropertyGroupIds: ['transform', 'audio'],
    })

    expect(screen.queryByText('Parameters')).toBeNull()
    expect(screen.queryByTestId('dopesheet-ruler')).toBeNull()
    expect(screen.queryByTestId('keyframe-navigator-property-column')).toBeNull()
    expect(screen.queryByRole('button', { name: /collapse transform/i })).toBeNull()
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeTruthy()
  })

  it('nests lane group headers and property rows beneath their owning layer', () => {
    renderEditor({
      presentation: 'lanes',
      propertyColumnWidth: 420,
    })

    const groupHeader = screen.getByText('Transform').closest('div.group')
    const propertyRow = screen.getByText('X Position').closest('div.group')

    expect(groupHeader).toHaveClass('pl-6', 'before:left-3')
    expect(propertyRow).toHaveClass('pl-9', 'before:left-3')
  })

  it('keeps visibility toggles when selecting a different active row in graph mode', () => {
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kf-x', frame: 10, value: 100, easing: 'linear' }],
        y: [{ id: 'kf-y', frame: 20, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
      visualizationMode: 'graph',
      onPropertyChange: vi.fn(),
    })

    const yToggle = screen.getByRole('button', {
      name: /show y position curve/i,
    })
    fireEvent.click(yToggle)
    expect(yToggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByText('X Position'))

    expect(yToggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('restores graph visibility toggles after remount', () => {
    const props = {
      itemId: 'item-persisted-visibility',
      keyframesByProperty: { x: [], y: [], rotation: [] },
      propertyValues: { x: 100, y: 200, rotation: 15 },
      visualizationMode: 'graph' as const,
    }

    const { unmount } = render(
      <DopesheetEditor currentFrame={12} width={640} height={240} {...props} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /show y position curve/i }))
    fireEvent.click(screen.getByRole('button', { name: /show rotation curve/i }))

    unmount()

    render(<DopesheetEditor currentFrame={12} width={640} height={240} {...props} />)

    expect(screen.getByRole('button', { name: /show x position curve/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /show y position curve/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /show rotation curve/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('shows a single horizontal zoom slider in the toolbar', () => {
    renderEditor()

    expect(screen.getAllByRole('slider')).toHaveLength(1)
    expect(screen.queryByTitle(/snapping enabled/i)).toBeNull()
  })

  it('shows horizontal and vertical zoom sliders in graph mode', () => {
    renderEditor({
      visualizationMode: 'graph',
      keyframesByProperty: {
        x: [{ id: 'kf-x', frame: 10, value: 100, easing: 'linear' }],
      },
      propertyValues: { x: 100 },
      selectedProperty: 'x',
    })

    expect(screen.getAllByRole('slider')).toHaveLength(2)
  })

  it('shows interpolation icon controls in both graph and sheet views', () => {
    const interpolationOptions = [
      { value: 'linear' as const, label: 'Linear' },
      { value: 'ease-in' as const, label: 'Ease In' },
    ]
    const onInterpolationChange = vi.fn()

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
      />,
    )

    expect(screen.getByRole('button', { name: /set interpolation to linear/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /set interpolation to ease in/i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /set interpolation to ease in/i }))
    expect(onInterpolationChange).toHaveBeenCalledWith('ease-in')

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
      />,
    )

    // The type selector is the single easing control, so it stays visible in
    // sheet view too (it used to be graph-only).
    expect(screen.getByRole('button', { name: /set interpolation to linear/i })).toBeTruthy()
  })

  it('deletes selected keyframes from the graph pane without bubbling to parent shortcuts', () => {
    const onRemoveKeyframes = vi.fn()
    const onParentKeyDown = vi.fn()

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
      </div>,
    )

    fireEvent.keyDown(screen.getByTestId('dopesheet-graph-pane'), {
      key: 'Delete',
    })

    expect(onRemoveKeyframes).toHaveBeenCalledWith([
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-1' },
    ])
    expect(onParentKeyDown).not.toHaveBeenCalled()
  })

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
      />,
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: /graph view options/i }), {
      button: 0,
      ctrlKey: false,
    })
    expect(screen.getByText(/display time ruler in seconds/i)).toBeTruthy()
    expect(screen.getByText(/display time ruler in frames/i)).toBeTruthy()
    expect(screen.getByText(/show all handles/i)).toBeTruthy()
  })

  it('shows the view options menu in sheet mode too', () => {
    renderEditor({ visualizationMode: 'dopesheet' })

    fireEvent.pointerDown(screen.getByRole('button', { name: /sheet view options/i }), {
      button: 0,
      ctrlKey: false,
    })

    expect(screen.getByText(/display time ruler in seconds/i)).toBeTruthy()
    expect(screen.getByText(/display time ruler in frames/i)).toBeTruthy()
    expect(screen.queryByText(/show all handles/i)).toBeNull()
  })

  it('renders the dopesheet ruler in seconds when seconds mode is enabled', () => {
    renderEditor({
      visualizationMode: 'dopesheet',
      totalFrames: 60,
      fps: 30,
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: /sheet view options/i }), {
      button: 0,
      ctrlKey: false,
    })
    fireEvent.click(screen.getByText(/display time ruler in seconds/i))

    expect(screen.getByTestId('dopesheet-ruler')).toHaveTextContent('1.00s')
  })

  it('renders clipboard controls in the bottom row', () => {
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
      },
      propertyValues: { x: 100 },
      selectedKeyframeIds: new Set(['kx-1']),
      onCopyKeyframes: vi.fn(),
      onCutKeyframes: vi.fn(),
      onPasteKeyframes: vi.fn(),
      hasKeyframeClipboard: true,
      isKeyframeClipboardCut: true,
    })

    expect(screen.getByRole('button', { name: /copy selected keyframes/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /cut selected keyframes/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /move keyframes from clipboard/i })).toBeTruthy()
    expect(screen.getByText('Cut')).toBeTruthy()
  })

  it('keeps only non-keyframing bulk controls on category headers', () => {
    renderEditor({
      keyframesByProperty: { x: [], y: [] },
      propertyValues: { x: 100, y: 200 },
      onPropertyValueCommit: vi.fn(),
    })

    expect(screen.getByRole('button', { name: /show all transform curves/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /lock transform rows/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /enable auto-key for transform/i })).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: /toggle transform keyframes at playhead/i,
      }),
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /lock transform rows/i }))

    expect(screen.getByRole('button', { name: /unlock transform rows/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('spinbutton', { name: /x position value at playhead/i })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: /y position value at playhead/i })).toBeDisabled()
  })

  it('keeps keyframe controls visible with reset in the fixed trailing slot', () => {
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
        y: [{ id: 'ky-1', frame: 16, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
      onNavigateToKeyframe: vi.fn(),
      onRemoveKeyframes: vi.fn(),
      onPropertyValueCommit: vi.fn(),
    })

    const curveButton = screen.getByRole('button', {
      name: /show all transform curves/i,
    })
    expect(curveButton.parentElement).not.toHaveClass('opacity-0', 'pointer-events-none')

    const headerButtons = [
      curveButton,
      screen.getByRole('button', { name: /lock transform rows/i }),
      screen.getByRole('button', { name: /previous transform keyframe/i }),
      screen.getByRole('button', { name: /next transform keyframe/i }),
    ]

    for (const button of headerButtons) {
      expect(button).not.toHaveClass('opacity-0', 'pointer-events-none')
    }

    expect(
      screen.getByRole('button', {
        name: /reset all transform animations to their base values/i,
      }),
    ).not.toHaveClass('opacity-0')
  })

  it('reserves the reset column when row and group reset menus are unavailable', () => {
    renderEditor()

    expect(screen.getByTestId('dopesheet-row-reset-spacer-x')).toHaveClass('w-5')
    expect(screen.getByTestId('dopesheet-row-reset-spacer-volume')).toHaveClass('w-5')
    expect(screen.getByTestId('dopesheet-group-reset-spacer-transform')).toHaveClass('w-5')
    expect(screen.getByTestId('dopesheet-group-reset-spacer-audio')).toHaveClass('w-5')
  })

  it('clears row and group keyframes', () => {
    const onRemoveKeyframes = vi.fn()
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
        y: [{ id: 'ky-1', frame: 16, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
      onRemoveKeyframes,
    })

    fireEvent.click(
      screen.getByRole('button', {
        name: /reset x position animation to its base value/i,
      }),
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: /reset all transform animations to their base values/i,
      }),
    )

    expect(onRemoveKeyframes).toHaveBeenNthCalledWith(1, [
      { itemId: 'item-1', property: 'x', keyframeId: 'kx-1' },
    ])
    expect(onRemoveKeyframes).toHaveBeenNthCalledWith(2, [
      { itemId: 'item-1', property: 'x', keyframeId: 'kx-1' },
      { itemId: 'item-1', property: 'y', keyframeId: 'ky-1' },
    ])
  })

  it('resets effect rows or their effect header to definition defaults', () => {
    const property = 'effect:gpu-color-wheels:wheels-1:exposure' as const
    const onResetPropertiesToDefault = vi.fn()
    renderEditor({
      keyframesByProperty: {
        [property]: [{ id: 'effect-kf', frame: 8, value: 1, easing: 'linear' }],
      },
      propertyValues: { [property]: 1 },
      onResetPropertiesToDefault,
    })

    fireEvent.click(
      screen.getByRole('button', {
        name: /reset color wheels: exposure \(ev\) to its default value/i,
      }),
    )
    expect(onResetPropertiesToDefault).toHaveBeenLastCalledWith([property])

    const groupReset = screen.getByRole('button', {
      name: /reset all color wheels properties to their default values/i,
    })
    expect(groupReset).not.toHaveClass('opacity-0')
    fireEvent.click(groupReset)
    expect(onResetPropertiesToDefault).toHaveBeenLastCalledWith([property])
  })

  it('navigates group keyframes with the header arrows', () => {
    const onNavigateToKeyframe = vi.fn()
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
        y: [{ id: 'ky-1', frame: 16, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
      onNavigateToKeyframe,
    })

    fireEvent.click(screen.getByRole('button', { name: /previous transform keyframe/i }))
    fireEvent.click(screen.getByRole('button', { name: /next transform keyframe/i }))

    expect(onNavigateToKeyframe).toHaveBeenNthCalledWith(1, 8)
    expect(onNavigateToKeyframe).toHaveBeenNthCalledWith(2, 16)
  })

  it('shows aggregate category diamonds only when child rows are collapsed', () => {
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
        y: [{ id: 'ky-1', frame: 8, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
    })

    expect(screen.queryByTestId('group-keyframe-transform-8')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /collapse transform/i }))
    expect(screen.getByTestId('group-keyframe-transform-8')).toBeTruthy()
  })

  it('selects and drags group header keyframes together in the sheet timeline', async () => {
    const onSelectionChange = vi.fn()
    const onKeyframeMove = vi.fn()

    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
        y: [{ id: 'ky-1', frame: 8, value: 200, easing: 'linear' }],
      },
      propertyValues: { x: 100, y: 200 },
      totalFrames: 100,
      onSelectionChange,
      onKeyframeMove,
    })

    fireEvent.click(screen.getByRole('button', { name: /collapse transform/i }))
    const groupKeyframe = screen.getByTestId('group-keyframe-transform-8')

    fireEvent.pointerDown(groupKeyframe, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 140 })

    await waitFor(() => {
      expect(screen.getByTestId('group-keyframe-transform-18')).toBeTruthy()
    })

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 140 })

    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['kx-1', 'ky-1']))
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kx-1' },
      18,
      100,
    )
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'y', keyframeId: 'ky-1' },
      18,
      200,
    )
  })

  it('allows multiple master diamonds to move as one selection', () => {
    const onKeyframeMove = vi.fn()

    function ControlledSelectionEditor() {
      const [selection, setSelection] = useState<Set<string>>(new Set())

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
          // Pin the viewport so the pixel↔frame mapping is independent of the
          // fit-to-keyframes default (which would otherwise zoom in on [8,16]).
          frameViewport={{ startFrame: 0, endFrame: 100 }}
          width={640}
          height={240}
          selectedKeyframeIds={selection}
          onSelectionChange={setSelection}
          onKeyframeMove={onKeyframeMove}
        />
      )
    }

    render(<ControlledSelectionEditor />)
    fireEvent.click(screen.getByRole('button', { name: /collapse transform/i }))

    fireEvent.pointerDown(screen.getByTestId('group-keyframe-transform-8'), {
      button: 0,
      pointerId: 1,
      clientX: 100,
    })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 100 })

    fireEvent.pointerDown(screen.getByTestId('group-keyframe-transform-16'), {
      button: 0,
      pointerId: 2,
      clientX: 140,
      ctrlKey: true,
    })
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 140 })

    fireEvent.pointerDown(screen.getByTestId('group-keyframe-transform-8'), {
      button: 0,
      pointerId: 3,
      clientX: 100,
    })
    fireEvent.pointerMove(window, { pointerId: 3, clientX: 140 })
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 140 })

    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kx-1' },
      18,
      100,
    )
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'y', keyframeId: 'ky-1' },
      18,
      200,
    )
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'x', keyframeId: 'kx-2' },
      26,
      140,
    )
    expect(onKeyframeMove).toHaveBeenCalledWith(
      { itemId: 'item-1', property: 'y', keyframeId: 'ky-2' },
      26,
      240,
    )
  })

  it('duplicates selected row keyframes with alt-drag instead of moving them', () => {
    const onDuplicateKeyframes = vi.fn()
    const onKeyframeMove = vi.fn()

    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
      },
      propertyValues: { x: 100 },
      totalFrames: 100,
      onKeyframeMove,
      onDuplicateKeyframes,
    })

    fireEvent.pointerDown(screen.getByTestId('row-keyframe-x-kx-1'), {
      button: 0,
      pointerId: 1,
      clientX: 100,
      altKey: true,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 140, altKey: true })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 140, altKey: true })

    expect(onKeyframeMove).not.toHaveBeenCalled()
    expect(onDuplicateKeyframes).toHaveBeenCalledWith([
      {
        ref: { itemId: 'item-1', property: 'x', keyframeId: 'kx-1' },
        frame: 18,
        value: 100,
      },
    ])
  })

  it('signals that an unlocked row keyframe is draggable', () => {
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
      },
      propertyValues: { x: 100 },
      totalFrames: 100,
    })

    const rowKeyframe = screen.getByTestId('row-keyframe-x-kx-1')

    expect(rowKeyframe.className).toContain('cursor-grab')
    expect(rowKeyframe.getAttribute('title')).toContain('drag to retime')
    expect(rowKeyframe).not.toBeDisabled()
  })

  it('shows a locked row keyframe as not draggable', () => {
    renderEditor({
      keyframesByProperty: {
        x: [{ id: 'kx-1', frame: 8, value: 100, easing: 'linear' }],
      },
      propertyValues: { x: 100 },
      totalFrames: 100,
    })

    fireEvent.click(screen.getByRole('button', { name: /lock x position row/i }))

    const rowKeyframe = screen.getByTestId('row-keyframe-x-kx-1')

    expect(rowKeyframe.className).toContain('cursor-not-allowed')
    expect(rowKeyframe.className).not.toContain('cursor-grab')
    expect(rowKeyframe).toBeDisabled()
  })
})
