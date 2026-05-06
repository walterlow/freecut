import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  clearMixerLiveGain,
  clearMixerLiveGainLayer,
  clearMixerLiveGains,
  setMixerLiveGainLayer,
  setMixerLiveGains,
  useMixerLiveGain,
} from './mixer-live-gain'

function GainProbe({ itemId, testId }: { itemId: string; testId: string }) {
  const gain = useMixerLiveGain(itemId)
  return <div data-testid={testId}>{String(gain)}</div>
}

function CountingGainProbe({
  itemId,
  testId,
  onRender,
}: {
  itemId: string
  testId: string
  onRender: () => void
}) {
  onRender()
  const gain = useMixerLiveGain(itemId)
  return <div data-testid={testId}>{String(gain)}</div>
}

describe('mixer-live-gain', () => {
  afterEach(() => {
    act(() => {
      clearMixerLiveGains()
    })
  })

  it('re-renders only the subscribed item when live gain changes', () => {
    let renderCountA = 0
    let renderCountB = 0

    render(
      <>
        <CountingGainProbe
          itemId="item-a"
          testId="gain-a"
          onRender={() => {
            renderCountA += 1
          }}
        />
        <CountingGainProbe
          itemId="item-b"
          testId="gain-b"
          onRender={() => {
            renderCountB += 1
          }}
        />
      </>,
    )

    expect(screen.getByTestId('gain-a').textContent).toBe('1')
    expect(screen.getByTestId('gain-b').textContent).toBe('1')
    expect(renderCountA).toBe(1)
    expect(renderCountB).toBe(1)

    act(() => {
      setMixerLiveGains([{ itemId: 'item-a', gain: 0.5 }])
    })

    expect(screen.getByTestId('gain-a').textContent).toBe('0.5')
    expect(screen.getByTestId('gain-b').textContent).toBe('1')
    expect(renderCountA).toBe(2)
    expect(renderCountB).toBe(1)

    act(() => {
      setMixerLiveGains([{ itemId: 'item-a', gain: 0.5 }])
    })

    expect(renderCountA).toBe(2)
    expect(renderCountB).toBe(1)

    act(() => {
      clearMixerLiveGain('item-a')
    })

    expect(screen.getByTestId('gain-a').textContent).toBe('1')
    expect(screen.getByTestId('gain-b').textContent).toBe('1')
    expect(renderCountA).toBe(3)
    expect(renderCountB).toBe(1)
  })

  it('clears unity gains without notifying unrelated subscribers', () => {
    render(
      <>
        <GainProbe itemId="item-a" testId="gain-a" />
        <GainProbe itemId="item-b" testId="gain-b" />
      </>,
    )

    act(() => {
      setMixerLiveGains([
        { itemId: 'item-a', gain: 0.25 },
        { itemId: 'item-b', gain: 0.75 },
      ])
    })

    expect(screen.getByTestId('gain-a').textContent).toBe('0.25')
    expect(screen.getByTestId('gain-b').textContent).toBe('0.75')

    act(() => {
      setMixerLiveGains([{ itemId: 'item-a', gain: 1 }])
    })

    expect(screen.getByTestId('gain-a').textContent).toBe('1')
    expect(screen.getByTestId('gain-b').textContent).toBe('0.75')
  })

  it('multiplies independent gain layers and clears them independently', () => {
    render(<GainProbe itemId="item-a" testId="gain-a" />)

    act(() => {
      setMixerLiveGains([{ itemId: 'item-a', gain: 0.5 }])
      setMixerLiveGainLayer('mute-solo', [{ itemId: 'item-a', gain: 0.25 }])
    })

    expect(screen.getByTestId('gain-a').textContent).toBe('0.125')

    act(() => {
      clearMixerLiveGainLayer('mute-solo')
    })

    expect(screen.getByTestId('gain-a').textContent).toBe('0.5')

    act(() => {
      clearMixerLiveGain('item-a')
    })

    expect(screen.getByTestId('gain-a').textContent).toBe('1')
  })
})
