import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'

import type { TimelineItem } from '@/types/timeline'
import type { CoordinateParams, Transform } from '../types/gizmo'
import { SelectableItem } from './selectable-item'

const ITEM = {
  id: 'text-1',
  type: 'text',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 30,
  label: 'Text',
} as TimelineItem

const TRANSFORM: Transform = {
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  rotation: 0,
  opacity: 1,
}

const COORD_PARAMS: CoordinateParams = {
  containerRect: new DOMRect(0, 0, 800, 450),
  playerSize: { width: 800, height: 450 },
  projectSize: { width: 1920, height: 1080 },
  zoom: -1,
}

describe('SelectableItem linked Position feedback', () => {
  it('selects quietly on click and reports only after a blocked drag begins', () => {
    const onSelect = vi.fn()
    const onDragStart = vi.fn()
    const onTranslateBlocked = vi.fn()

    const clearSelection = vi.fn()
    const { container } = render(
      <div onClick={clearSelection}>
        <SelectableItem
          item={ITEM}
          transform={TRANSFORM}
          coordParams={COORD_PARAMS}
          onSelect={onSelect}
          onDragStart={onDragStart}
          translateBlocked
          onTranslateBlocked={onTranslateBlocked}
        />
      </div>,
    )
    const canvas = container.firstElementChild as HTMLElement
    const target = container.querySelector<HTMLElement>('[data-gizmo="selectable-item"]')!

    fireEvent.mouseDown(target, { clientX: 100, clientY: 100 })
    expect(target).toHaveClass('cursor-move')
    expect(document.body).not.toHaveClass('canvas-translate-cursor-not-allowed')
    fireEvent.mouseUp(window, { clientX: 100, clientY: 100 })

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onDragStart).not.toHaveBeenCalled()
    expect(onTranslateBlocked).not.toHaveBeenCalled()

    fireEvent.mouseDown(target, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 102, clientY: 102 })
    expect(onTranslateBlocked).not.toHaveBeenCalled()

    fireEvent.mouseMove(window, { clientX: 106, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 110, clientY: 100 })

    expect(onTranslateBlocked).toHaveBeenCalledOnce()
    expect(onDragStart).not.toHaveBeenCalled()
    expect(document.body).toHaveClass('canvas-translate-cursor-not-allowed')

    fireEvent.mouseUp(window, { clientX: 110, clientY: 100 })
    fireEvent.click(canvas)

    expect(document.body).not.toHaveClass('canvas-translate-cursor-not-allowed')
    expect(clearSelection).not.toHaveBeenCalled()
  })

  it('still begins an unblocked translation on mouse-down', () => {
    const onDragStart = vi.fn()

    const { container } = render(
      <SelectableItem
        item={ITEM}
        transform={TRANSFORM}
        coordParams={COORD_PARAMS}
        onSelect={vi.fn()}
        onDragStart={onDragStart}
      />,
    )
    const target = container.querySelector<HTMLElement>('[data-gizmo="selectable-item"]')!

    fireEvent.mouseDown(target, { clientX: 100, clientY: 100 })

    expect(onDragStart).toHaveBeenCalledOnce()
  })
})
