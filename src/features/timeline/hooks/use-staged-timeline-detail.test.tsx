import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  _resetTimelineDetailPromotionForTest,
  MIN_TIMELINE_DETAIL_PROMOTION_BATCH_SIZE,
  TIMELINE_DETAIL_PROMOTION_BATCH_SIZE,
  useStagedTimelineDetailIds,
} from './use-staged-timeline-detail'

let nextAnimationFrameId = 1
let animationFrames = new Map<number, FrameRequestCallback>()
let animationFrameTimestamp = 0
const EMPTY_IMMEDIATE_IDS = new Set<string>()

function DetailProbe({
  eligibleIds,
  isZoomInteracting,
  testId = 'promoted-ids',
}: {
  eligibleIds: string[]
  isZoomInteracting: boolean
  testId?: string
}) {
  const promotedIds = useStagedTimelineDetailIds(
    eligibleIds,
    EMPTY_IMMEDIATE_IDS,
    isZoomInteracting,
  )
  return <div data-testid={testId}>{Array.from(promotedIds).join(',')}</div>
}

function flushOneAnimationFrame(frameDuration = 16) {
  const entry = animationFrames.entries().next().value as [number, FrameRequestCallback] | undefined
  if (!entry) return
  animationFrames.delete(entry[0])
  animationFrameTimestamp += frameDuration
  entry[1](animationFrameTimestamp)
}

describe('useStagedTimelineDetailIds', () => {
  beforeEach(() => {
    _resetTimelineDetailPromotionForTest()
    nextAnimationFrameId = 1
    animationFrames = new Map()
    animationFrameTimestamp = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId++
      animationFrames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      animationFrames.delete(id)
    })
  })

  it('demotes immediately and promotes newly detailed clips in bounded frames', () => {
    const ids = Array.from({ length: 10 }, (_, index) => `clip-${index}`)
    const view = render(<DetailProbe eligibleIds={ids} isZoomInteracting={false} />)
    expect(screen.getByTestId('promoted-ids').textContent?.split(',')).toHaveLength(10)

    view.rerender(<DetailProbe eligibleIds={[]} isZoomInteracting={false} />)
    expect(screen.getByTestId('promoted-ids')).toHaveTextContent('')

    view.rerender(<DetailProbe eligibleIds={ids} isZoomInteracting />)
    expect(screen.getByTestId('promoted-ids')).toHaveTextContent('')

    view.rerender(<DetailProbe eligibleIds={ids} isZoomInteracting={false} />)
    expect(screen.getByTestId('promoted-ids')).toHaveTextContent('')

    act(flushOneAnimationFrame)
    expect(screen.getByTestId('promoted-ids').textContent?.split(',')).toHaveLength(
      MIN_TIMELINE_DETAIL_PROMOTION_BATCH_SIZE,
    )

    let previousCount = MIN_TIMELINE_DETAIL_PROMOTION_BATCH_SIZE
    while ((screen.getByTestId('promoted-ids').textContent?.split(',').length ?? 0) < 10) {
      act(flushOneAnimationFrame)
      const nextCount = screen.getByTestId('promoted-ids').textContent?.split(',').length ?? 0
      expect(nextCount - previousCount).toBeLessThanOrEqual(TIMELINE_DETAIL_PROMOTION_BATCH_SIZE)
      previousCount = nextCount
    }
    expect(screen.getByTestId('promoted-ids').textContent?.split(',')).toHaveLength(10)
  })

  it('shares one promotion budget across visible tracks', () => {
    const firstIds = Array.from({ length: 8 }, (_, index) => `first-${index}`)
    const secondIds = Array.from({ length: 8 }, (_, index) => `second-${index}`)
    const view = render(
      <>
        <DetailProbe eligibleIds={[]} isZoomInteracting testId="first" />
        <DetailProbe eligibleIds={[]} isZoomInteracting testId="second" />
      </>,
    )

    view.rerender(
      <>
        <DetailProbe eligibleIds={firstIds} isZoomInteracting={false} testId="first" />
        <DetailProbe eligibleIds={secondIds} isZoomInteracting={false} testId="second" />
      </>,
    )
    act(flushOneAnimationFrame)
    act(flushOneAnimationFrame)

    const firstCount =
      screen.getByTestId('first').textContent?.split(',').filter(Boolean).length ?? 0
    const secondCount =
      screen.getByTestId('second').textContent?.split(',').filter(Boolean).length ?? 0
    expect(firstCount + secondCount).toBe(MIN_TIMELINE_DETAIL_PROMOTION_BATCH_SIZE * 2)
    expect(firstCount).toBeGreaterThan(0)
    expect(secondCount).toBeGreaterThan(0)
  })

  it('grows its batch only on stable frames and falls back after a missed frame', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `adaptive-${index}`)
    const view = render(<DetailProbe eligibleIds={[]} isZoomInteracting />)
    view.rerender(<DetailProbe eligibleIds={ids} isZoomInteracting={false} />)

    act(flushOneAnimationFrame)
    act(flushOneAnimationFrame)
    act(flushOneAnimationFrame)
    const beforeGrowth = screen.getByTestId('promoted-ids').textContent?.split(',').length ?? 0
    act(flushOneAnimationFrame)
    const afterGrowth = screen.getByTestId('promoted-ids').textContent?.split(',').length ?? 0
    expect(afterGrowth - beforeGrowth).toBe(2)

    act(() => flushOneAnimationFrame(40))
    const afterSlowFrame = screen.getByTestId('promoted-ids').textContent?.split(',').length ?? 0
    expect(afterSlowFrame - afterGrowth).toBe(MIN_TIMELINE_DETAIL_PROMOTION_BATCH_SIZE)
  })
})
