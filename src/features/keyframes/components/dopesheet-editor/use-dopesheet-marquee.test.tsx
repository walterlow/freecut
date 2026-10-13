import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { KeyframeMarqueeOverlay } from '../keyframe-marquee'
import { useDopesheetMarquee } from './use-dopesheet-marquee'

interface HarnessProps {
  onSelectionChange: (
    keyframeIds: Set<string>,
    options?: { preserveExternalSelection?: boolean },
  ) => void
  onSelectionPreviewChange: (keyframeIds: Set<string> | null) => void
  getKeyframePoints: () => Array<{ keyframeId: string; x: number; y: number }>
}

function MarqueeHarness({
  onSelectionChange,
  onSelectionPreviewChange,
  getKeyframePoints,
}: HarnessProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const { marqueeOverlayRef, beginMarqueeSelection } = useDopesheetMarquee({
    getKeyframePoints,
    scrollAreaRef,
    getTimelineXFromClientX: (clientX) => clientX,
    getContentYFromClientY: (clientY) => clientY,
    onSelectionChange,
    onSelectionPreviewChange,
  })

  return (
    <div ref={scrollAreaRef}>
      <button
        type="button"
        onPointerDown={(event) =>
          beginMarqueeSelection(event.pointerId, event.clientX, event.clientY, 'replace', new Set())
        }
      >
        Start marquee
      </button>
      <KeyframeMarqueeOverlay ref={marqueeOverlayRef} rect={null} persistent />
    </div>
  )
}

describe('useDopesheetMarquee', () => {
  let rafCallbacks: FrameRequestCallback[]

  beforeEach(() => {
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => {}
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('keeps marquee movement local and commits selection once on release', () => {
    const onSelectionChange =
      vi.fn<(keyframeIds: Set<string>, options?: { preserveExternalSelection?: boolean }) => void>()
    const onSelectionPreviewChange = vi.fn<(keyframeIds: Set<string> | null) => void>()
    const getKeyframePoints = vi.fn<() => Array<{ keyframeId: string; x: number; y: number }>>(
      () => [
        { keyframeId: 'inside', x: 10, y: 10 },
        { keyframeId: 'outside', x: 80, y: 80 },
      ],
    )
    render(
      <MarqueeHarness
        onSelectionChange={onSelectionChange}
        onSelectionPreviewChange={onSelectionPreviewChange}
        getKeyframePoints={getKeyframePoints}
      />,
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Start marquee' }), {
      pointerId: 7,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 20, clientY: 20 })

    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(rafCallbacks).toHaveLength(1)
    rafCallbacks[0]?.(16)

    const overlay = document.querySelector<HTMLDivElement>('[aria-hidden="true"]')
    expect(overlay).not.toBeNull()
    expect(overlay).not.toHaveAttribute('hidden')
    expect(overlay).toHaveStyle({ transform: 'translate3d(0px,0px,0)', width: '20px' })
    expect(onSelectionPreviewChange).toHaveBeenLastCalledWith(new Set(['inside']))
    expect(onSelectionChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(window, { pointerId: 7, clientX: 20, clientY: 20 })

    expect(getKeyframePoints).toHaveBeenCalledTimes(1)
    expect(onSelectionChange).toHaveBeenCalledTimes(1)
    expect(onSelectionChange.mock.calls[0]?.[0]).toEqual(new Set(['inside']))
    expect(overlay).toHaveAttribute('hidden')
    expect(onSelectionPreviewChange).toHaveBeenLastCalledWith(null)
  })

  it('coalesces pointer bursts and cancels without committing', () => {
    const onSelectionChange =
      vi.fn<(keyframeIds: Set<string>, options?: { preserveExternalSelection?: boolean }) => void>()
    const onSelectionPreviewChange = vi.fn<(keyframeIds: Set<string> | null) => void>()
    render(
      <MarqueeHarness
        onSelectionChange={onSelectionChange}
        onSelectionPreviewChange={onSelectionPreviewChange}
        getKeyframePoints={() => [{ keyframeId: 'key', x: 10, y: 10 }]}
      />,
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Start marquee' }), {
      pointerId: 9,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 30, clientY: 30 })

    expect(rafCallbacks).toHaveLength(1)
    rafCallbacks[0]?.(16)
    expect(onSelectionPreviewChange).toHaveBeenCalledTimes(1)

    fireEvent.pointerCancel(window, { pointerId: 9 })
    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(onSelectionPreviewChange).toHaveBeenLastCalledWith(null)
  })
})
